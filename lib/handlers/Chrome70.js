const sdpTransform = require('sdp-transform');
const Logger = require('../Logger');
const EnhancedEventEmitter = require('../EnhancedEventEmitter');
const utils = require('../utils');
const ortc = require('../ortc');
const sdpCommonUtils = require('./sdp/commonUtils');
const sdpUnifiedPlanUtils = require('./sdp/unifiedPlanUtils');
const RemoteSdp = require('./sdp/RemoteSdp');

const logger = new Logger('LPZ Client Chrome70');

class Handler extends EnhancedEventEmitter
{
	constructor(
		{
			iceParameters,
			iceCandidates,
			dtlsParameters,
			iceServers,
			iceTransportPolicy,
			proprietaryConstraints
		}
	)
	{
		super(logger);
		logger.debug('Handler, constructor, [iceParameters:%o, iceCandidates:%o, dtlsParameters:%o, ' +
			'iceServers:%o, iceTransportPolicy:%o, proprietaryConstraints:%o]',
			iceParameters, iceCandidates, dtlsParameters, iceServers, iceTransportPolicy, proprietaryConstraints);

		// Got transport local and remote parameters.
		// @type {Boolean}
		this._transportReady = false;

		logger.debug('Handler, constructor, Create Remote SDP handler');
		// Remote SDP handler.
		// @type {RemoteSdp}
		this._remoteSdp = new RemoteSdp(
			{
				iceParameters,
				iceCandidates,
				dtlsParameters
			});

		logger.debug('Handler, constructor, [_remoteSdp:%o]', this._remoteSdp);

		logger.debug('Handler, constructor, Create RTCPeerConnection instance');
		// RTCPeerConnection instance.
		// @type {RTCPeerConnection}
		this._pc = new RTCPeerConnection(
			{
				iceServers         : iceServers || [],
				iceTransportPolicy : iceTransportPolicy || 'all',
				bundlePolicy       : 'max-bundle',
				rtcpMuxPolicy      : 'require',
				sdpSemantics       : 'unified-plan'
			},
			proprietaryConstraints);

		logger.debug('Handler, constructor, [RTCPeerConnection:%o]', this._pc);

		// Map of RTCTransceivers indexed by MID.
		// @type {Map<String, RTCTransceiver>}
		this._mapMidTransceiver = new Map();

		// Handle RTCPeerConnection connection status.
		this._pc.addEventListener('iceconnectionstatechange', () =>
		{
			logger.debug('Handler, constructor, this._pc.addEventListener, iceconnectionstatechange, [iceConnectionState:%o]', this._pc.iceConnectionState);
			switch (this._pc.iceConnectionState)
			{
				case 'checking':
					this.emit('@connectionstatechange', 'connecting');
					break;
				case 'connected':
				case 'completed':
					this.emit('@connectionstatechange', 'connected');
					break;
				case 'failed':
					this.emit('@connectionstatechange', 'failed');
					break;
				case 'disconnected':
					this.emit('@connectionstatechange', 'disconnected');
					break;
				case 'closed':
					this.emit('@connectionstatechange', 'closed');
					break;
			}
		});
	}

	close()
	{
		logger.debug('Handler, close()');

		// Close RTCPeerConnection.
		try { this._pc.close(); }
		catch (error) {}
	}

	async getTransportStats()
	{
		return this._pc.getStats();
	}

	async updateIceServers({ iceServers })
	{
		logger.debug('Handler, updateIceServers(), [iceServers:%o]', iceServers);

		const configuration = this._pc.getConfiguration();

		configuration.iceServers = iceServers;

		logger.debug('Handler, updateIceServers(), [configuration:%o]', configuration);
		this._pc.setConfiguration(configuration);
	}

	async _setupTransport({ localDtlsRole, localSdpObject = null })
	{
		logger.debug('Handler, _setupTransport(), [localDtlsRole:%o, localSdpObject:%o]', localDtlsRole, localSdpObject);
		if (!localSdpObject)
		{
			logger.debug('Handler, _setupTransport(), [this._pc.localDescription.sdp:%o]', this._pc.localDescription.sdp);
			localSdpObject = sdpTransform.parse(this._pc.localDescription.sdp);
			logger.debug('Handler, _setupTransport(), [localSdpObject:%o]', localSdpObject);
		}

		// Get our local DTLS parameters.
		const dtlsParameters =
			sdpCommonUtils.extractDtlsParameters({ sdpObject: localSdpObject });

		// Set our DTLS role.
		dtlsParameters.role = localDtlsRole;

		logger.debug('Handler, _setupTransport(), [dtlsParameters:%o]', dtlsParameters);

		// Update the remote DTLS role in the SDP.
		this._remoteSdp.updateDtlsRole(
			localDtlsRole === 'client' ? 'server' : 'client');

		logger.debug('Handler, _setupTransport(), send connect');
		// Need to tell the remote transport about our parameters.
		await this.safeEmitAsPromise('@connect', { dtlsParameters });

		this._transportReady = true;
	}
}

class SendHandler extends Handler
{
	constructor(data)
	{
		super(data);

		logger.debug('SendHandler, constructor, [data:%o]', data);
		// Generic sending RTP parameters for audio and video.
		// @type {RTCRtpParameters}
		this._sendingRtpParametersByKind = data.sendingRtpParametersByKind;

		// Generic sending RTP parameters for audio and video suitable for the SDP
		// remote answer.
		// @type {RTCRtpParameters}
		this._sendingRemoteRtpParametersByKind = data.sendingRemoteRtpParametersByKind;

		logger.debug('SendHandler, constructor, Create MediaStream');
		// Local stream.
		// @type {MediaStream}
		this._stream = new MediaStream();

		logger.debug('SendHandler, constructor, [_stream:%o]', this._stream);
	}

	async send({ track, encodings, codecOptions })
	{
		logger.debug('SendHandler, send() [track:%o, encodings:%o, codecOptions:%o]', track, encodings, codecOptions);

		logger.debug('SendHandler, send(), addTransceiver, sendonly, [streams:%o]', this._stream);
		const transceiver = this._pc.addTransceiver(
			track, { direction: 'sendonly', streams: [ this._stream ] });
		logger.debug('SendHandler, send(), addTransceiver end, [transceiver:%o]', transceiver);

		let offer = await this._pc.createOffer();
		logger.debug('SendHandler, send(), create offer, [offer:%o]', offer);

		logger.debug('SendHandler, send(), sdpTransform');
		let localSdpObject = sdpTransform.parse(offer.sdp);
		logger.debug('SendHandler, send(), sdpTransform.parse, [localSdpObject:%o]', localSdpObject);

		logger.debug('SendHandler, send(), [_sendingRtpParametersByKind:%o, kind:%o]', this._sendingRtpParametersByKind, track.kind);
		let offerMediaObject;
		const sendingRtpParameters =
			utils.clone(this._sendingRtpParametersByKind[track.kind]);
		logger.debug('SendHandler, send(), [sendingRtpParameters:%o]', sendingRtpParameters);

		if (!this._transportReady)
		{
			logger.debug('SendHandler, send(), _setupTransport');
			await this._setupTransport({ localDtlsRole: 'server', localSdpObject });
		}

		if (encodings && encodings.length > 1)
		{
			logger.debug('SendHandler send() | enabling legacy simulcast, [encodings:%o]', encodings);

			localSdpObject = sdpTransform.parse(offer.sdp);

			logger.debug('SendHandler send() | enabling legacy simulcast, [localSdpObject:%o]', localSdpObject);
			// We know that our media section is the last one.
			offerMediaObject = localSdpObject.media[localSdpObject.media.length - 1];
			logger.debug('SendHandler send() | enabling legacy simulcast, [offerMediaObject:%o]', offerMediaObject);

			logger.debug('SendHandler send() | enabling legacy simulcast, sdpUnifiedPlanUtils.addLegacySimulcast');
			sdpUnifiedPlanUtils.addLegacySimulcast(
				{
					offerMediaObject,
					numStreams : encodings.length
				});

			offer = { type: 'offer', sdp: sdpTransform.write(localSdpObject) };
			logger.debug('SendHandler send() | enabling legacy simulcast, [offer:%o]', offer);
		}

		logger.debug(
			'send() | calling pc.setLocalDescription() [offer:%o]', offer);

		await this._pc.setLocalDescription(offer);

		// We can now get the transceiver.mid.
		const localId = transceiver.mid;

		logger.debug('SendHandler send(), [localId:%o]', localId);

		// Set MID.
		sendingRtpParameters.mid = localId;

		logger.debug('SendHandler send(), [this._pc.localDescription.sdp:%o]', this._pc.localDescription.sdp);
		localSdpObject = sdpTransform.parse(this._pc.localDescription.sdp);
		offerMediaObject = localSdpObject.media[localSdpObject.media.length - 1];
		logger.debug('SendHandler send(), [localSdpObject:%o]', localSdpObject);
		logger.debug('SendHandler send(), [offerMediaObject:%o]', offerMediaObject);

		// Set RTCP CNAME.
		sendingRtpParameters.rtcp.cname =
			sdpCommonUtils.getCname({ offerMediaObject });
		logger.debug('SendHandler send(), [sendingRtpParameters.rtcp.cname:%o]', sendingRtpParameters.rtcp.cname);

		// Set RTP encodings.
		sendingRtpParameters.encodings =
			sdpUnifiedPlanUtils.getRtpEncodings({ offerMediaObject });
		logger.debug('SendHandler send(), [sendingRtpParameters.encodings:%o]', sendingRtpParameters.encodings);

		// If VP8 and there is effective simulcast, add scalabilityMode to each
		// encoding.
		if (
			sendingRtpParameters.encodings.length > 1 &&
			sendingRtpParameters.codecs[0].mimeType.toLowerCase() === 'video/vp8'
		)
		{
			for (const encoding of sendingRtpParameters.encodings)
			{
				encoding.scalabilityMode = 'L1T3';
			}
			logger.debug('SendHandler send(), video/vp8, scalabilityMode to L1T3');
		}

		logger.debug('SendHandler send(), this._remoteSdp.send');
		this._remoteSdp.send(
			{
				offerMediaObject,
				offerRtpParameters  : sendingRtpParameters,
				answerRtpParameters : this._sendingRemoteRtpParametersByKind[track.kind],
				codecOptions
			});

		const answer = { type: 'answer', sdp: this._remoteSdp.getSdp() };

		logger.debug(
			'send() | calling pc.setRemoteDescription() [answer:%o]', answer);

		await this._pc.setRemoteDescription(answer);

		// Store in the map.
		this._mapMidTransceiver.set(localId, transceiver);

		logger.debug('SendHandler send(), return [localId.encodings:%o, sendingRtpParameters:%o]', localId, sendingRtpParameters);
		return { localId, rtpParameters: sendingRtpParameters };
	}

	async stopSending({ localId })
	{
		logger.debug('SendHandler stopSending() [localId:%s]', localId);

		const transceiver = this._mapMidTransceiver.get(localId);

		logger.debug('SendHandler stopSending() [transceiver:%s]', transceiver);
		if (!transceiver)
			throw new Error('associated RTCRtpTransceiver not found');

		transceiver.sender.replaceTrack(null);
		this._pc.removeTrack(transceiver.sender);
		this._remoteSdp.disableMediaSection(transceiver.mid);

		const offer = await this._pc.createOffer();

		logger.debug(
			'SendHandler stopSending() | calling pc.setLocalDescription() [offer:%o]', offer);

		await this._pc.setLocalDescription(offer);

		const answer = { type: 'answer', sdp: this._remoteSdp.getSdp() };

		logger.debug(
			'SendHandler stopSending() | calling pc.setRemoteDescription() [answer:%o]', answer);

		await this._pc.setRemoteDescription(answer);
	}

	async replaceTrack({ localId, track })
	{
		logger.debug('SendHandler replaceTrack() [localId:%s, track.id:%s, track:%o]', localId, track.id, track);

		const transceiver = this._mapMidTransceiver.get(localId);

		logger.debug('SendHandler replaceTrack() [transceiver:%s]', transceiver);

		if (!transceiver)
			throw new Error('associated RTCRtpTransceiver not found');

		await transceiver.sender.replaceTrack(track);
	}

	async setMaxSpatialLayer({ localId, spatialLayer })
	{
		logger.debug(
			'SendHandler setMaxSpatialLayer() [localId:%s, spatialLayer:%s]',
			localId, spatialLayer);

		const transceiver = this._mapMidTransceiver.get(localId);
		logger.debug('SendHandler setMaxSpatialLayer() [transceiver:%s]', transceiver);

		if (!transceiver)
			throw new Error('associated RTCRtpTransceiver not found');

		const parameters = transceiver.sender.getParameters();
		logger.debug('SendHandler setMaxSpatialLayer() [parameters:%s]', parameters);

		parameters.encodings.forEach((encoding, idx) =>
		{
			if (idx <= spatialLayer)
			{
				encoding.active = true;
			}
			else
			{
				encoding.active = false;
			}
			logger.debug('SendHandler setMaxSpatialLayer(), [idx:%o] [encoding.active:%o]', idx, encoding.active);
		});

		logger.debug('SendHandler setMaxSpatialLayer() return [parameters:%s]', parameters);
		await transceiver.sender.setParameters(parameters);
	}

	async getSenderStats({ localId })
	{
		const transceiver = this._mapMidTransceiver.get(localId);
		logger.debug('SendHandler getSenderStats() [localId:%s]', localId);
		logger.debug('SendHandler getSenderStats() [transceiver:%s]', transceiver);

		if (!transceiver)
			throw new Error('associated RTCRtpTransceiver not found');

		return transceiver.sender.getStats();
	}

	async restartIce({ iceParameters })
	{
		logger.debug('SendHandler restartIce(), [iceParameters:%o]', iceParameters);

		// Provide the remote SDP handler with new remote ICE parameters.
		this._remoteSdp.updateIceParameters(iceParameters);

		if (!this._transportReady)
		{
			logger.debug('SendHandler restartIce(), return 1');
			return;
		}

		const offer = await this._pc.createOffer({ iceRestart: true });

		logger.debug(
			'SendHandler restartIce() | calling pc.setLocalDescription() [offer:%o]', offer);

		await this._pc.setLocalDescription(offer);

		const answer = { type: 'answer', sdp: this._remoteSdp.getSdp() };

		logger.debug(
			'SendHandler restartIce() | calling pc.setRemoteDescription() [answer:%o]', answer);

		await this._pc.setRemoteDescription(answer);
	}
}

class RecvHandler extends Handler
{
	constructor(data)
	{
		super(data);
		logger.debug('RecvHandler, constructor, [data:%o]', data);

		// MID value counter. It must be converted to string and incremented for
		// each new m= section.
		// @type {Number}
		this._nextMid = 0;
	}

	async receive({ id, kind, rtpParameters })
	{
		logger.debug('RecvHandler, receive(), [id:%s, kind:%s, rtpParameters:%o]', id, kind, rtpParameters);

		const localId = String(this._nextMid);
		logger.debug('RecvHandler, receive(), [localId:%o]', localId);

		this._remoteSdp.receive(
			{
				mid                : localId,
				kind,
				offerRtpParameters : rtpParameters,
				streamId           : rtpParameters.rtcp.cname,
				trackId            : id
			});

		const offer = { type: 'offer', sdp: this._remoteSdp.getSdp() };

		logger.debug(
			'RecvHandler, receive() | calling pc.setRemoteDescription() [offer:%o]', offer);

		await this._pc.setRemoteDescription(offer);

		let answer = await this._pc.createAnswer();
		logger.debug('RecvHandler, receive(), create answer [answer:%o]', answer);
		
		const localSdpObject = sdpTransform.parse(answer.sdp);
		logger.debug('RecvHandler, receive(), [localSdpObject:%o]', localSdpObject);
		
		const answerMediaObject = localSdpObject.media
			.find((m) => String(m.mid) === localId);

		logger.debug('RecvHandler, receive(), [answerMediaObject:%o]', answerMediaObject);
		// May need to modify codec parameters in the answer based on codec
		// parameters in the offer.
		sdpCommonUtils.applyCodecParameters(
			{
				offerRtpParameters : rtpParameters,
				answerMediaObject
			});

		answer = { type: 'answer', sdp: sdpTransform.write(localSdpObject) };
		logger.debug('RecvHandler, receive(), [answer:%o]', answer);

		if (!this._transportReady)
			await this._setupTransport({ localDtlsRole: 'client', localSdpObject });

		logger.debug(
			'RecvHandler receive() | calling pc.setLocalDescription() [answer:%o]', answer);

		await this._pc.setLocalDescription(answer);

		const transceiver = this._pc.getTransceivers()
			.find((t) => t.mid === localId);

		logger.debug('RecvHandler, receive(), [transceiver:%o]', transceiver);

		if (!transceiver)
			throw new Error('new RTCRtpTransceiver not found');

		// Store in the map.
		this._mapMidTransceiver.set(localId, transceiver);

		// Increase next MID.
		this._nextMid++;

		logger.debug('RecvHandler, receive(), return [localId:%o, track:%o]', localId, transceiver.receiver.track);
		return { localId, track: transceiver.receiver.track };
	}

	async stopReceiving({ localId })
	{
		logger.debug('RecvHandler, stopReceiving() [localId:%s]', localId);

		const transceiver = this._mapMidTransceiver.get(localId);
		logger.debug('RecvHandler, stopReceiving() [transceiver:%s]', transceiver);

		if (!transceiver)
			throw new Error('associated RTCRtpTransceiver not found');

		this._remoteSdp.disableMediaSection(transceiver.mid);

		const offer = { type: 'offer', sdp: this._remoteSdp.getSdp() };

		logger.debug(
			'RecvHandler, stopReceiving() | calling pc.setRemoteDescription() [offer:%o]', offer);

		await this._pc.setRemoteDescription(offer);

		const answer = await this._pc.createAnswer();

		logger.debug(
			'RecvHandler, stopReceiving() | calling pc.setLocalDescription() [answer:%o]', answer);

		await this._pc.setLocalDescription(answer);
	}

	async getReceiverStats({ localId })
	{
		logger.debug('RecvHandler, getReceiverStats() [localId:%s]', localId);
		const transceiver = this._mapMidTransceiver.get(localId);
		logger.debug('RecvHandler, getReceiverStats() [transceiver:%s]', transceiver);

		if (!transceiver)
			throw new Error('associated RTCRtpTransceiver not found');

		return transceiver.receiver.getStats();
	}

	async restartIce({ iceParameters })
	{
		logger.debug('RecvHandler, restartIce(), [iceParameters:%o]', iceParameters);

		// Provide the remote SDP handler with new remote ICE parameters.
		this._remoteSdp.updateIceParameters(iceParameters);

		if (!this._transportReady)
		{
			logger.debug('RecvHandler, restartIce(), return 1');
			return;
		}

		const offer = { type: 'offer', sdp: this._remoteSdp.getSdp() };

		logger.debug(
			'RecvHandler, restartIce() | calling pc.setRemoteDescription() [offer:%o]', offer);

		await this._pc.setRemoteDescription(offer);

		const answer = await this._pc.createAnswer();

		logger.debug(
			'RecvHandler, restartIce() | calling pc.setLocalDescription() [answer:%o]', answer);

		await this._pc.setLocalDescription(answer);
	}
}

class Chrome70
{
	static async getNativeRtpCapabilities()
	{
		logger.debug('Chrome70, getNativeRtpCapabilities()');
		logger.debug('Chrome70, getNativeRtpCapabilities(), new RTCPeerConnection');
		const pc = new RTCPeerConnection(
			{
				iceServers         : [],
				iceTransportPolicy : 'all',
				bundlePolicy       : 'max-bundle',
				rtcpMuxPolicy      : 'require',
				sdpSemantics       : 'unified-plan'
			});

		logger.debug('Chrome70, getNativeRtpCapabilities(), [pc:%o]', pc);
		try
		{
			pc.addTransceiver('audio');
			pc.addTransceiver('video');
			logger.debug('Chrome70, getNativeRtpCapabilities(), addTransceiver, audio/video');

			const offer = await pc.createOffer();
			logger.debug('Chrome70, getNativeRtpCapabilities(), [offer:%o]', offer);

			try { pc.close(); }
			catch (error) {}

			const sdpObject = sdpTransform.parse(offer.sdp);
			logger.debug('Chrome70, getNativeRtpCapabilities(), [sdpObject:%o]', sdpObject);
			const nativeRtpCapabilities =
				sdpCommonUtils.extractRtpCapabilities({ sdpObject });

			logger.debug('Chrome70, getNativeRtpCapabilities(), return [nativeRtpCapabilities:%o]', nativeRtpCapabilities);
			return nativeRtpCapabilities;
		}
		catch (error)
		{
			try { pc.close(); }
			catch (error2) {}

			throw error;
		}
	}

	constructor(
		{
			direction,
			iceParameters,
			iceCandidates,
			dtlsParameters,
			iceServers,
			iceTransportPolicy,
			proprietaryConstraints,
			extendedRtpCapabilities
		}
	)
	{
		logger.debug('Chrome70, constructor() [direction:%s, iceParameters:%o, iceCandidates:%o, '+
			'dtlsParameters:%o, iceServers:%o, iceTransportPolicy:%o, proprietaryConstraints:%o, extendedRtpCapabilities:%o]',
			direction, iceParameters, iceCandidates, dtlsParameters, iceServers, iceTransportPolicy,
			proprietaryConstraints, extendedRtpCapabilities);

		switch (direction)
		{
			case 'send':
			{
				const sendingRtpParametersByKind =
				{
					audio : ortc.getSendingRtpParameters('audio', extendedRtpCapabilities),
					video : ortc.getSendingRtpParameters('video', extendedRtpCapabilities)
				};

				const sendingRemoteRtpParametersByKind =
				{
					audio : ortc.getSendingRemoteRtpParameters('audio', extendedRtpCapabilities),
					video : ortc.getSendingRemoteRtpParameters('video', extendedRtpCapabilities)
				};

				logger.debug('Chrome70, constructor() send, new SendHandler');
				return new SendHandler(
					{
						iceParameters,
						iceCandidates,
						dtlsParameters,
						iceServers,
						iceTransportPolicy,
						proprietaryConstraints,
						sendingRtpParametersByKind,
						sendingRemoteRtpParametersByKind
					});
			}

			case 'recv':
			{
				logger.debug('Chrome70, constructor() recv, new RecvHandler');
				return new RecvHandler(
					{
						iceParameters,
						iceCandidates,
						dtlsParameters,
						iceServers,
						iceTransportPolicy,
						proprietaryConstraints
					});
			}
		}
	}
}

module.exports = Chrome70;
