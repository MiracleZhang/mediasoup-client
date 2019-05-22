const utils = require('../../utils');
const Logger = require('../../Logger');
const logger = new Logger('LPZ Client MediaSection');


class MediaSection
{
	constructor(
		{
			iceParameters = undefined,
			iceCandidates = undefined,
			dtlsParameters = undefined,
			planB = false
		} = {}
	)
	{
		logger.debug('MediaSection constructor, [iceParameters:%o, iceCandidates:%o, dtlsParameters:%o, planB:%o]', iceParameters, iceCandidates, dtlsParameters, planB);

		// SDP media object.
		// @type {Object}
		this._mediaObject = {};

		// Whether this is Plan-B SDP.
		// @type {Boolean}
		this._planB = planB;

		if (iceParameters)
		{
			this.setIceParameters(iceParameters);
		}

		if (iceCandidates)
		{
			this._mediaObject.candidates = [];

			for (const candidate of iceCandidates)
			{
				const candidateObject = {};

				// mediasoup does mandates rtcp-mux so candidates component is always
				// RTP (1).
				candidateObject.component = 1;
				candidateObject.foundation = candidate.foundation;
				candidateObject.ip = candidate.ip;
				candidateObject.port = candidate.port;
				candidateObject.priority = candidate.priority;
				candidateObject.transport = candidate.protocol;
				candidateObject.type = candidate.type;
				if (candidate.tcpType)
					candidateObject.tcptype = candidate.tcpType;

				this._mediaObject.candidates.push(candidateObject);
			}

			this._mediaObject.endOfCandidates = 'end-of-candidates';
			this._mediaObject.iceOptions = 'renomination';
		}

		logger.debug('MediaSection constructor, [this._mediaObject:%o]', this._mediaObject);

		if (dtlsParameters)
		{
			this.setDtlsRole(dtlsParameters.role);
		}
	}

	/**
	 * @returns {String}
	 */
	get mid()
	{
		logger.debug('MediaSection get mid, [mid:%o]', this._mediaObject.mid);
		return this._mediaObject.mid;
	}

	/**
	 * @returns {Object}
	 */
	getObject()
	{
		logger.debug('MediaSection getObject, [this._mediaObject:%o]', this._mediaObject);
		return this._mediaObject;
	}

	/**
	 * @param {RTCIceParameters} iceParameters
	 */
	setIceParameters(iceParameters)
	{
		logger.debug('MediaSection setIceParameters, [iceParameters:%o]', iceParameters);
		this._mediaObject.iceUfrag = iceParameters.usernameFragment;
		this._mediaObject.icePwd = iceParameters.password;
		logger.debug('MediaSection setIceParameters, [this._mediaObject:%o]', this._mediaObject);
	}

	disable()
	{
		this._mediaObject.direction = 'inactive';

		delete this._mediaObject.ext;
		delete this._mediaObject.ssrcs;
		delete this._mediaObject.ssrcGroups;
		delete this._mediaObject.simulcast;
		delete this._mediaObject.simulcast_03;
		delete this._mediaObject.rids;
	}
}

class AnswerMediaSection extends MediaSection
{
	constructor(data)
	{
		super(data);
		logger.debug('AnswerMediaSection constructor, [data:%o]', data);

		const {
			offerMediaObject,
			offerRtpParameters,
			answerRtpParameters,
			plainRtpParameters,
			codecOptions
		} = data;

		this._mediaObject.mid = String(offerMediaObject.mid);
		this._mediaObject.type = offerMediaObject.type;

		if (!plainRtpParameters)
		{
			logger.debug('AnswerMediaSection constructor, [plainRtpParameters:false]]');
			this._mediaObject.connection = { ip: '127.0.0.1', version: 4 };
			this._mediaObject.protocol = offerMediaObject.protocol;
			this._mediaObject.port = 7;
		}
		else
		{
			logger.debug('AnswerMediaSection constructor, [plainRtpParameters:true]]');
			this._mediaObject.connection =
			{
				ip      : plainRtpParameters.ip,
				version : plainRtpParameters.ipVersion
			};
			this._mediaObject.protocol = 'RTP/AVP';
			this._mediaObject.port = plainRtpParameters.port;
		}

		this._mediaObject.direction = 'recvonly';
		this._mediaObject.rtp = [];
		this._mediaObject.rtcpFb = [];
		this._mediaObject.fmtp = [];

		logger.debug('AnswerMediaSection constructor, 1 [this._mediaObject:%o]', this._mediaObject);

		let index = 0;
		for (const codec of answerRtpParameters.codecs)
		{
			logger.debug('AnswerMediaSection constructor, [%d], [codec:%o]', index, codec);
			const rtp =
			{
				payload : codec.payloadType,
				codec   : codec.mimeType.replace(/^.*\//, ''),
				rate    : codec.clockRate
			};

			if (codec.channels > 1)
				rtp.encoding = codec.channels;

			this._mediaObject.rtp.push(rtp);

			const codecParameters = utils.clone(codec.parameters || {});

			logger.debug('AnswerMediaSection constructor, [%d], [rtp:%o, codecParameters:%o]', index, rtp, codecParameters);
			if (codecOptions)
			{
				const {
					opusStereo,
					opusFec,
					opusDtx,
					opusMaxPlaybackRate,
					videoGoogleStartBitrate,
					videoGoogleMaxBitrate,
					videoGoogleMinBitrate
				} = codecOptions;

				logger.debug('AnswerMediaSection constructor, [%d], [codecOptions:%o]', index, codecOptions);
				const offerCodec = offerRtpParameters.codecs
					.find((c) => c.payloadType === codec.payloadType);

				logger.debug('AnswerMediaSection constructor, [%d], old [offerCodec:%o]', index, offerCodec);
				switch (codec.mimeType.toLowerCase())
				{
					case 'audio/opus':
					{
						if (opusStereo !== undefined)
						{
							offerCodec.parameters['sprop-stereo'] = opusStereo ? 1 : 0;
							codecParameters.stereo = opusStereo ? 1 : 0;
						}

						if (opusFec !== undefined)
						{
							offerCodec.parameters.useinbandfec = opusFec ? 1 : 0;
							codecParameters.useinbandfec = opusFec ? 1 : 0;
						}

						if (opusDtx !== undefined)
						{
							offerCodec.parameters.usedtx = opusDtx ? 1 : 0;
							codecParameters.usedtx = opusDtx ? 1 : 0;
						}

						if (opusMaxPlaybackRate !== undefined)
							codecParameters.maxplaybackrate = opusMaxPlaybackRate;

						break;
					}

					case 'video/vp8':
					case 'video/vp9':
					case 'video/h264':
					case 'video/h265':
					{
						if (videoGoogleStartBitrate !== undefined)
							codecParameters['x-google-start-bitrate'] = videoGoogleStartBitrate;

						if (videoGoogleMaxBitrate !== undefined)
							codecParameters['x-google-max-bitrate'] = videoGoogleMaxBitrate;

						if (videoGoogleMinBitrate !== undefined)
							codecParameters['x-google-min-bitrate'] = videoGoogleMinBitrate;

						break;
					}
				}

				logger.debug('AnswerMediaSection constructor, [%d], new [offerCodec:%o]', index, offerCodec);
			}

			logger.debug('AnswerMediaSection constructor, [%d], [codecParameters:%o]', index, codecParameters);
			
			const fmtp =
			{
				payload : codec.payloadType,
				config  : ''
			};

			for (const key of Object.keys(codecParameters))
			{
				if (fmtp.config)
					fmtp.config += ';';

				fmtp.config += `${key}=${codecParameters[key]}`;
			}

			if (fmtp.config)
				this._mediaObject.fmtp.push(fmtp);

			logger.debug('AnswerMediaSection constructor, [%d], [fmtp:%o]', index, fmtp);
			if (codec.rtcpFeedback)
			{
				for (const fb of codec.rtcpFeedback)
				{
					this._mediaObject.rtcpFb.push(
						{
							payload : codec.payloadType,
							type    : fb.type,
							subtype : fb.parameter || ''
						});
				}
				logger.debug('AnswerMediaSection constructor, rtcpFeedback, [%d], [this._mediaObject.rtcpFb:%o]', index, this._mediaObject.rtcpFb);
			}
			index++;
		}

		this._mediaObject.payloads = answerRtpParameters.codecs
			.map((codec) => codec.payloadType)
			.join(' ');

		this._mediaObject.ext = [];

		for (const ext of answerRtpParameters.headerExtensions)
		{
			// Don't add a header extension if not present in the offer.
			const found = (offerMediaObject.ext || [])
				.some((localExt) => localExt.uri === ext.uri);

			if (!found)
				continue;

			this._mediaObject.ext.push(
				{
					uri   : ext.uri,
					value : ext.id
				});
		}

		// Simulcast.
		if (offerMediaObject.simulcast)
		{
			logger.debug('AnswerMediaSection constructor, [offerMediaObject.simulcast:true]');
			this._mediaObject.simulcast =
			{
				dir1  : 'recv',
				list1 : offerMediaObject.simulcast.list1
			};

			this._mediaObject.rids = [];

			for (const rid of offerMediaObject.rids || [])
			{
				if (rid.direction !== 'send')
					continue;

				this._mediaObject.rids.push(
					{
						id        : rid.id,
						direction : 'recv'
					});
			}
		}
		// Simulcast (draft version 03).
		else if (offerMediaObject.simulcast_03)
		{
			logger.debug('AnswerMediaSection constructor, [offerMediaObject.simulcast_03:true]');
			// eslint-disable-next-line camelcase
			this._mediaObject.simulcast_03 =
			{
				value : offerMediaObject.simulcast_03.value.replace(/send/g, 'recv')
			};

			this._mediaObject.rids = [];

			for (const rid of offerMediaObject.rids || [])
			{
				if (rid.direction !== 'send')
					continue;

				this._mediaObject.rids.push(
					{
						id        : rid.id,
						direction : 'recv'
					});
			}
		}

		this._mediaObject.rtcpMux = 'rtcp-mux';
		this._mediaObject.rtcpRsize = 'rtcp-rsize';

		if (this._planB && this._mediaObject.type === 'video')
			this._mediaObject.xGoogleFlag = 'conference';

		logger.debug('AnswerMediaSection constructor, [this._mediaObject:%o]', this._mediaObject);
	}

	/**
	 * @param {String} role
	 */
	setDtlsRole(role)
	{
		switch (role)
		{
			case 'client':
				this._mediaObject.setup = 'active';
				break;
			case 'server':
				this._mediaObject.setup = 'passive';
				break;
			case 'auto':
				this._mediaObject.setup = 'actpass';
				break;
		}

		logger.debug('AnswerMediaSection, setDtlsRole, [role:%o, this._mediaObject.setup:%o]', role, this._mediaObject.setup);
	}
}

class OfferMediaSection extends MediaSection
{
	constructor(data)
	{
		super(data);

		logger.debug('OfferMediaSection, constructor, [data:%o]', data);

		const {
			plainRtpParameters,
			mid,
			kind,
			offerRtpParameters,
			streamId,
			trackId
		} = data;

		this._mediaObject.mid = String(mid);
		this._mediaObject.type = kind;

		if (!plainRtpParameters)
		{
			logger.debug('OfferMediaSection, constructor, [plainRtpParameters:false]');
			this._mediaObject.connection = { ip: '127.0.0.1', version: 4 };
			this._mediaObject.protocol = 'UDP/TLS/RTP/SAVPF';
			this._mediaObject.port = 7;
		}
		else
		{
			logger.debug('OfferMediaSection, constructor, [plainRtpParameters:true]');
			this._mediaObject.connection =
			{
				ip      : plainRtpParameters.ip,
				version : plainRtpParameters.ipVersion
			};
			this._mediaObject.protocol = 'RTP/AVP';
			this._mediaObject.port = plainRtpParameters.port;
		}

		this._mediaObject.direction = 'sendonly';
		this._mediaObject.rtp = [];
		this._mediaObject.rtcpFb = [];
		this._mediaObject.fmtp = [];

		if (!this._planB)
			this._mediaObject.msid = `${streamId || '-'} ${trackId}`;

		let index = 0;
		for (const codec of offerRtpParameters.codecs)
		{
			logger.debug('OfferMediaSection, constructor, [%d], [codec:%o]', index, codec);
			const rtp =
			{
				payload : codec.payloadType,
				codec   : codec.mimeType.replace(/^.*\//, ''),
				rate    : codec.clockRate
			};

			if (codec.channels > 1)
				rtp.encoding = codec.channels;

			this._mediaObject.rtp.push(rtp);

			if (codec.parameters)
			{
				const fmtp =
				{
					payload : codec.payloadType,
					config  : ''
				};

				for (const key of Object.keys(codec.parameters))
				{
					if (fmtp.config)
						fmtp.config += ';';

					fmtp.config += `${key}=${codec.parameters[key]}`;
				}

				if (fmtp.config)
					this._mediaObject.fmtp.push(fmtp);

				logger.debug('OfferMediaSection, constructor, [%d], [fmtp.config:%o]', index, fmtp.config);
			}

			if (codec.rtcpFeedback)
			{
				for (const fb of codec.rtcpFeedback)
				{
					this._mediaObject.rtcpFb.push(
						{
							payload : codec.payloadType,
							type    : fb.type,
							subtype : fb.parameter || ''
						});
				}
				logger.debug('OfferMediaSection, constructor, [%d], [this._mediaObject.rtcpFb:%o]', index, this._mediaObject.rtcpFb);
			}
			index++;
		}

		this._mediaObject.payloads = offerRtpParameters.codecs
			.map((codec) => codec.payloadType)
			.join(' ');

		this._mediaObject.ext = [];

		for (const ext of offerRtpParameters.headerExtensions)
		{
			this._mediaObject.ext.push(
				{
					uri   : ext.uri,
					value : ext.id
				});
		}

		this._mediaObject.rtcpMux = 'rtcp-mux';
		this._mediaObject.rtcpRsize = 'rtcp-rsize';

		const encoding = offerRtpParameters.encodings[0];
		const ssrc = encoding.ssrc;
		const rtxSsrc = (encoding.rtx && encoding.rtx.ssrc)
			? encoding.rtx.ssrc
			: undefined;

		this._mediaObject.ssrcs = [];
		this._mediaObject.ssrcGroups = [];

		if (offerRtpParameters.rtcp.cname)
		{
			logger.debug('OfferMediaSection, constructor, [offerRtpParameters.rtcp.cname:%o]', offerRtpParameters.rtcp.cname);
			this._mediaObject.ssrcs.push(
				{
					id        : ssrc,
					attribute : 'cname',
					value     : offerRtpParameters.rtcp.cname
				});
		}

		if (this._planB)
		{
			logger.debug('OfferMediaSection, constructor, [this._planB:true, value:%o]', `${streamId || '-'} ${trackId}`);
			this._mediaObject.ssrcs.push(
				{
					id        : ssrc,
					attribute : 'msid',
					value     : `${streamId || '-'} ${trackId}`
				});
		}

		if (rtxSsrc)
		{
			logger.debug('OfferMediaSection, constructor, [rtxSsrc:%o]', rtxSsrc);
			if (offerRtpParameters.rtcp.cname)
			{
				logger.debug('OfferMediaSection, constructor, rtxSsrc, [offerRtpParameters.rtcp.cname:%o]', offerRtpParameters.rtcp.cname);
				this._mediaObject.ssrcs.push(
					{
						id        : rtxSsrc,
						attribute : 'cname',
						value     : offerRtpParameters.rtcp.cname
					});
			}

			if (this._planB)
			{
				logger.debug('OfferMediaSection, constructor, rtxSsrc, [value:%o]', `${streamId || '-'} ${trackId}`);
				this._mediaObject.ssrcs.push(
					{
						id        : rtxSsrc,
						attribute : 'msid',
						value     : `${streamId || '-'} ${trackId}`
					});
			}

			logger.debug('OfferMediaSection, constructor, rtxSsrc, [ssrcs:%o]', `${ssrc} ${rtxSsrc}`);
			// Associate original and retransmission SSRCs.
			this._mediaObject.ssrcGroups.push(
				{
					semantics : 'FID',
					ssrcs     : `${ssrc} ${rtxSsrc}`
				});
		}

		logger.debug('OfferMediaSection, constructor, [this._mediaObject:%o]', this._mediaObject);
	}

	/**
	 * @param {String} role
	 */
	setDtlsRole(role) // eslint-disable-line no-unused-vars
	{
		// Always 'actpass'.
		this._mediaObject.setup = 'actpass';
		logger.debug('OfferMediaSection, setDtlsRole, [this._mediaObject.setup:%o]', this._mediaObject.setup);
	}

	planBReceive({ offerRtpParameters, streamId, trackId })
	{
		logger.debug('OfferMediaSection, planBReceive, [offerRtpParameters:%o, streamId:%o, trackId:%o]', offerRtpParameters, streamId, trackId);
		const encoding = offerRtpParameters.encodings[0];
		const ssrc = encoding.ssrc;
		const rtxSsrc = (encoding.rtx && encoding.rtx.ssrc)
			? encoding.rtx.ssrc
			: undefined;

		logger.debug('OfferMediaSection, planBReceive, [ssrc:%o, rtxSsrc:%o]', ssrc, rtxSsrc);
		if (offerRtpParameters.rtcp.cname)
		{
			logger.debug('OfferMediaSection, planBReceive, [offerRtpParameters.rtcp.cname:%o]', offerRtpParameters.rtcp.cname);
			this._mediaObject.ssrcs.push(
				{
					id        : ssrc,
					attribute : 'cname',
					value     : offerRtpParameters.rtcp.cname
				});
		}

		logger.debug('OfferMediaSection, planBReceive, [value:%o]', `${streamId || '-'} ${trackId}`);
		this._mediaObject.ssrcs.push(
			{
				id        : ssrc,
				attribute : 'msid',
				value     : `${streamId || '-'} ${trackId}`
			});

		if (rtxSsrc)
		{
			logger.debug('OfferMediaSection, planBReceive, [rtxSsrc:%o]', rtxSsrc);
			if (offerRtpParameters.rtcp.cname)
			{
				logger.debug('OfferMediaSection, planBReceive, rtxSsrc, [offerRtpParameters.rtcp.cname:%o]', offerRtpParameters.rtcp.cname);
				this._mediaObject.ssrcs.push(
					{
						id        : rtxSsrc,
						attribute : 'cname',
						value     : offerRtpParameters.rtcp.cname
					});
			}

			logger.debug('OfferMediaSection, planBReceive, rtxSsrc, [value:%o]', `${streamId || '-'} ${trackId}`);
			this._mediaObject.ssrcs.push(
				{
					id        : rtxSsrc,
					attribute : 'msid',
					value     : `${streamId || '-'} ${trackId}`
				});

			logger.debug('OfferMediaSection, planBReceive, rtxSsrc, [ssrcs:%o]', `${ssrc} ${rtxSsrc}`);
			// Associate original and retransmission SSRCs.
			this._mediaObject.ssrcGroups.push(
				{
					semantics : 'FID',
					ssrcs     : `${ssrc} ${rtxSsrc}`
				});
		}
		logger.debug('OfferMediaSection, planBReceive, [this._mediaObject:%o]', this._mediaObject);
	}

	planBStopReceiving({ offerRtpParameters })
	{
		logger.debug('OfferMediaSection, planBStopReceiving, [offerRtpParameters:%o]', offerRtpParameters);
		const encoding = offerRtpParameters.encodings[0];
		const ssrc = encoding.ssrc;
		const rtxSsrc = (encoding.rtx && encoding.rtx.ssrc)
			? encoding.rtx.ssrc
			: undefined;

		this._mediaObject.ssrcs = this._mediaObject.ssrcs
			.filter((s) => s.id !== ssrc && s.id !== rtxSsrc);

		logger.debug('OfferMediaSection, planBStopReceiving, [this._mediaObject.ssrcs:%o]', this._mediaObject.ssrcs);
		if (rtxSsrc)
		{
			this._mediaObject.ssrcGroups = this._mediaObject.ssrcGroups
				.filter((group) => group.ssrcs !== `${ssrc} ${rtxSsrc}`);

			logger.debug('OfferMediaSection, planBStopReceiving, rtxSsrc. [this._mediaObject.ssrcGroups:%o]', this._mediaObject.ssrcGroups);
		}
	}
}

module.exports =
{
	AnswerMediaSection,
	OfferMediaSection
};
