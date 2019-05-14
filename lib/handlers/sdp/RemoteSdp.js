const sdpTransform = require('sdp-transform');
const Logger = require('../../Logger');
const { AnswerMediaSection, OfferMediaSection } = require('./MediaSection');

const logger = new Logger('LPZ Client RemoteSdp');

class RemoteSdp
{
	constructor(
		{
			iceParameters = undefined,
			iceCandidates = undefined,
			dtlsParameters = undefined,
			plainRtpParameters = undefined,
			planB = false
		})
	{
		logger.debug('constructor, [iceParameters:%o, iceCandidates:%o, dtlsParameters:%o, plainRtpParameters:%o, planB:%o]',
			iceParameters, iceCandidates, dtlsParameters, plainRtpParameters, planB);
		// Remote ICE parameters.
		// @type {RTCIceParameters}
		this._iceParameters = iceParameters;

		// Remote ICE candidates.
		// @type {Array<RTCIceCandidate>}
		this._iceCandidates = iceCandidates;

		// Remote DTLS parameters.
		// @type {RTCDtlsParameters}
		this._dtlsParameters = dtlsParameters;

		// Parameters for plain RTP (no SRTP nor DTLS no BUNDLE). Fields:
		// @type {Object}
		//
		// Fields:
		// @param {String} ip
		// @param {Number} ipVersion - 4 or 6.
		// @param {Number} port
		this._plainRtpParameters = plainRtpParameters;

		// Whether this is Plan-B SDP.
		// @type {Boolean}
		this._planB = planB;

		// MediaSection instances indexed by MID.
		// @type {Map<String, MediaSection>}
		this._mediaSections = new Map();

		// SDP object.
		// @type {Object}
		this._sdpObject =
		{
			version : 0,
			origin  :
			{
				address        : '0.0.0.0',
				ipVer          : 4,
				netType        : 'IN',
				sessionId      : 10000,
				sessionVersion : 0,
				username       : 'mediasoup-client'
			},
			name   : '-',
			timing : { start: 0, stop: 0 },
			media  : []
		};

		// If ICE parameters are given, add ICE-Lite indicator.
		if (iceParameters && iceParameters.iceLite)
		{
			this._sdpObject.icelite = 'ice-lite';
		}

		// If DTLS parameters are given assume WebRTC and BUNDLE.
		if (dtlsParameters)
		{
			this._sdpObject.msidSemantic = { semantic: 'WMS', token: '*' };

			// NOTE: We take the latest fingerprint.
			const numFingerprints = this._dtlsParameters.fingerprints.length;

			this._sdpObject.fingerprint =
			{
				type : dtlsParameters.fingerprints[numFingerprints - 1].algorithm,
				hash : dtlsParameters.fingerprints[numFingerprints - 1].value
			};

			this._sdpObject.groups = [ { type: 'BUNDLE', mids: '' } ];
		}

		// If there are plain parameters override SDP origin.
		if (plainRtpParameters)
		{
			this._sdpObject.origin.address = plainRtpParameters.ip;
			this._sdpObject.origin.ipVer = plainRtpParameters.ipVersion;
		}

		logger.debug('constructor, [_sdpObject:%o]', this._sdpObject);
	}

	updateIceParameters(iceParameters)
	{
		logger.debug(
			'updateIceParameters() [iceParameters:%o]',
			iceParameters);

		this._iceParameters = iceParameters;
		this._sdpObject.icelite = iceParameters.iceLite ? 'ice-lite' : undefined;

		logger.debug('updateIceParameters, [this._sdpObject.icelite:%o]', this._sdpObject.icelite);

		for (const mediaSection of this._mediaSections.values())
		{
			mediaSection.setIceParameters(iceParameters);
		}
		logger.debug('updateIceParameters, [this._mediaSections:%o]', this._mediaSections);
	}

	updateDtlsRole(role)
	{
		logger.debug('updateDtlsRole() [role:%s]', role);

		this._dtlsParameters.role = role;

		for (const mediaSection of this._mediaSections.values())
		{
			mediaSection.setDtlsRole(role);
		}
	}

	send(
		{
			offerMediaObject,
			offerRtpParameters,
			answerRtpParameters,
			codecOptions
		}
	)
	{
		logger.debug('send, [offerMediaObject:%o, offerRtpParameters:%o, answerRtpParameters:%o, '+
			'codecOptions:%o]', offerMediaObject, offerRtpParameters, answerRtpParameters, codecOptions);
		
		logger.debug('send, create AnswerMediaSection');
		const mediaSection = new AnswerMediaSection(
			{
				iceParameters      : this._iceParameters,
				iceCandidates      : this._iceCandidates,
				dtlsParameters     : this._dtlsParameters,
				plainRtpParameters : this._plainRtpParameters,
				planB              : this._planB,
				offerMediaObject,
				offerRtpParameters,
				answerRtpParameters,
				codecOptions
			});

		// Unified-Plan or different media kind.
		if (!this._mediaSections.has(mediaSection.mid))
		{
			logger.debug('send, _addMediaSection. [Unified-Plan or different media kind.], [mediaSection:%o]', mediaSection);
			this._addMediaSection(mediaSection);
		}
		// Plan-B.
		else
		{
			logger.debug('send, _replaceMediaSection. [Plan-B], [mediaSection:%o]', mediaSection);
			this._replaceMediaSection(mediaSection);
		}
	}

	receive(
		{
			mid,
			kind,
			offerRtpParameters,
			streamId,
			trackId
		}
	)
	{
		logger.debug('receive, [mid:%o, kind:%o, offerRtpParameters:%o, streamId:%o, trackId:%o]', mid, kind, offerRtpParameters, streamId, trackId);
		// Unified-Plan or different media kind.
		if (!this._mediaSections.has(mid))
		{
			logger.debug('receive, create OfferMediaSection');
			const mediaSection = new OfferMediaSection(
				{
					iceParameters      : this._iceParameters,
					iceCandidates      : this._iceCandidates,
					dtlsParameters     : this._dtlsParameters,
					plainRtpParameters : this._plainRtpParameters,
					planB              : this._planB,
					mid,
					kind,
					offerRtpParameters,
					streamId,
					trackId
				});

			logger.debug('receive, _addMediaSection. [Unified-Plan or different media kind.], [mediaSection:%o]', mediaSection);
			this._addMediaSection(mediaSection);
		}
		// Plan-B.
		else
		{
			const mediaSection = this._mediaSections.get(mid);

			mediaSection.planBReceive({ offerRtpParameters, streamId, trackId });
			logger.debug('receive, _replaceMediaSection. [Plan-B], [mediaSection:%o]', mediaSection);
			this._replaceMediaSection(mediaSection);
		}
	}

	disableMediaSection(mid)
	{
		const mediaSection = this._mediaSections.get(mid);

		mediaSection.disable();
		logger.debug('disableMediaSection, [mid:%o, mediaSection:%o]', mid, mediaSection);
	}

	planBStopReceiving({ mid, offerRtpParameters })
	{
		const mediaSection = this._mediaSections.get(mid);
		logger.debug('planBStopReceiving, [mid:%o, mediaSection:%o, offerRtpParameters:%o]', mid, mediaSection, offerRtpParameters);

		mediaSection.planBStopReceiving({ offerRtpParameters });
		this._replaceMediaSection(mediaSection);
	}

	getSdp()
	{
		let oldSdpObject = sdpTransform.write(this._sdpObject);
		logger.debug('getSdp, [oldSdpObject:%o]', oldSdpObject);

		// Increase SDP version.
		this._sdpObject.origin.sessionVersion++;

		let newSdpObject = sdpTransform.write(this._sdpObject);

		logger.debug('getSdp, [newSdpObject:%o]', newSdpObject);

		return tmpSdpObject;
	}

	_addMediaSection(mediaSection)
	{
		logger.debug('_addMediaSection, [mediaSection:%o]', mediaSection);

		// Store it in the map.
		this._mediaSections.set(mediaSection.mid, mediaSection);

		// Update SDP object.
		this._sdpObject.media.push(mediaSection.getObject());
		logger.debug('_addMediaSection, update sdp, [this._sdpObject.media:%o]', this._sdpObject.media);

		logger.debug('_addMediaSection, update sdp, old [this._sdpObject.groups[0].mids:%o]', this._sdpObject.groups[0].mids);
		if (this._dtlsParameters)
		{
			this._sdpObject.groups[0].mids =
				`${this._sdpObject.groups[0].mids} ${mediaSection.mid}`.trim();
		}
		logger.debug('_addMediaSection, update sdp, new [this._sdpObject.groups[0].mids:%o]', this._sdpObject.groups[0].mids);
	}

	_replaceMediaSection(mediaSection)
	{
		logger.debug('_replaceMediaSection, [mediaSection:%o]', mediaSection);

		// Store it in the map.
		this._mediaSections.set(mediaSection.mid, mediaSection);

		logger.debug('_replaceMediaSection, old, [this._sdpObject.media:%o]', this._sdpObject.media);

		// Update SDP object.
		this._sdpObject.media = this._sdpObject.media
			.map((m) =>
			{
				if (String(m.mid) === mediaSection.mid)
					return mediaSection.getObject();
				else
					return m;
			});
		logger.debug('_replaceMediaSection, new, [this._sdpObject.media:%o]', this._sdpObject.media);
	}
}

module.exports = RemoteSdp;
