const sdpTransform = require('sdp-transform');

const Logger = require('../../Logger');
const logger = new Logger('LPZ Client CommonUtils');

/**
 * Extract RTP capabilities.
 *
 * @param {Object} sdpObject - SDP Object generated by sdp-transform.
 *
 * @returns {RTCRtpCapabilities}
 */
exports.extractRtpCapabilities = function({ sdpObject })
{
	logger.debug('extractRtpCapabilities, [sdpObject:%o]', sdpObject);
	// Map of RtpCodecParameters indexed by payload type.
	const codecsMap = new Map();
	// Array of RtpHeaderExtensions.
	const headerExtensions = [];
	// Whether a m=audio/video section has been already found.
	let gotAudio = false;
	let gotVideo = false;

	for (const m of sdpObject.media)
	{
		const kind = m.type;

		switch (kind)
		{
			case 'audio':
			{
				if (gotAudio)
					continue;

				gotAudio = true;

				break;
			}
			case 'video':
			{
				if (gotVideo)
					continue;

				gotVideo = true;

				break;
			}
			default:
			{
				continue;
			}
		}

		// Get codecs.
		for (const rtp of m.rtp)
		{
			const codec =
			{
				mimeType             : `${kind}/${rtp.codec}`,
				kind                 : kind,
				clockRate            : rtp.rate,
				preferredPayloadType : rtp.payload,
				channels             : rtp.encoding,
				rtcpFeedback         : [],
				parameters           : {}
			};

			if (codec.kind !== 'audio')
				delete codec.channels;
			else if (!codec.channels)
				codec.channels = 1;

			codecsMap.set(codec.preferredPayloadType, codec);
		}

		// Get codec parameters.
		for (const fmtp of m.fmtp || [])
		{
			const parameters = sdpTransform.parseFmtpConfig(fmtp.config);
			const codec = codecsMap.get(fmtp.payload);

			if (!codec)
				continue;

			// Special case to convert parameter value to string.
			if (parameters && parameters['profile-level-id'])
				parameters['profile-level-id'] = String(parameters['profile-level-id']);

			codec.parameters = parameters;
		}

		// Get RTCP feedback for each codec.
		for (const fb of m.rtcpFb || [])
		{
			const codec = codecsMap.get(fb.payload);

			if (!codec)
				continue;

			const feedback =
			{
				type      : fb.type,
				parameter : fb.subtype
			};

			if (!feedback.parameter)
				delete feedback.parameter;

			codec.rtcpFeedback.push(feedback);
		}

		// Get RTP header extensions.
		for (const ext of m.ext || [])
		{
			const headerExtension =
			{
				kind        : kind,
				uri         : ext.uri,
				preferredId : ext.value
			};

			headerExtensions.push(headerExtension);
		}
	}

	const rtpCapabilities =
	{
		codecs           : Array.from(codecsMap.values()),
		headerExtensions : headerExtensions,
		fecMechanisms    : []
	};

	logger.debug('extractRtpCapabilities, return [rtpCapabilities:%o]', rtpCapabilities);
	return rtpCapabilities;
};

/**
 * Extract DTLS parameters.
 *
 * @param {Object} sdpObject - SDP Object generated by sdp-transform.
 *
 * @returns {RTCDtlsParameters}
 */
exports.extractDtlsParameters = function({ sdpObject })
{
	logger.debug('extractDtlsParameters, [sdpObject:%o]', sdpObject);
	const mediaObject = (sdpObject.media || [])
		.find((m) => m.iceUfrag && m.port !== 0);

	logger.debug('extractDtlsParameters, [mediaObject:%o]', mediaObject);
	if (!mediaObject)
		throw new Error('no active media section found');

	const fingerprint = mediaObject.fingerprint || sdpObject.fingerprint;
	let role;
	logger.debug('extractDtlsParameters, [fingerprint:%o]', fingerprint);

	switch (mediaObject.setup)
	{
		case 'active':
			role = 'client';
			break;
		case 'passive':
			role = 'server';
			break;
		case 'actpass':
			role = 'auto';
			break;
	}

	const dtlsParameters =
	{
		role,
		fingerprints :
		[
			{
				algorithm : fingerprint.type,
				value     : fingerprint.hash
			}
		]
	};

	logger.debug('extractDtlsParameters, return [dtlsParameters:%o]', dtlsParameters);
	return dtlsParameters;
};

/**
 * Get RTCP CNAME.
 *
 * @param {Object} offerMediaObject - Local SDP media Object generated by sdp-transform.
 *
 * @returns {String}
 */
exports.getCname = function({ offerMediaObject })
{
	logger.debug('getCname, [offerMediaObject:%o]', offerMediaObject);
	const ssrcCnameLine = (offerMediaObject.ssrcs || [])
		.find((line) => line.attribute === 'cname');

	logger.debug('getCname, [ssrcCnameLine:%o]', ssrcCnameLine);
	if (!ssrcCnameLine)
		return '';

	return ssrcCnameLine.value;
};

/**
 * Apply codec parameters in the given SDP m= section answer based on the
 * given RTP parameters of an offer.
 *
 * @param {RTCRtpParameters} offerRtpParameters
 * @param {Object} answerMediaObject
 */
exports.applyCodecParameters = function(
	{
		offerRtpParameters,
		answerMediaObject
	}
)
{
	logger.debug('applyCodecParameters, [offerRtpParameters:%o, answerMediaObject:%o]', offerRtpParameters, answerMediaObject);
	let index = 0;
	for (const codec of offerRtpParameters.codecs)
	{
		const mimeType = codec.mimeType.toLowerCase();
		logger.debug('applyCodecParameters, [%d], [mimeType:%o]', index, mimeType);

		// Avoid parsing codec parameters for unhandled codecs.
		if (mimeType !== 'audio/opus')
		{
			logger.debug('applyCodecParameters, [%d], not opus, continue');
			index++;
			continue;
		}

		const rtp = (answerMediaObject.rtp || [])
			.find((r) => r.payload === codec.payloadType);

		logger.debug('applyCodecParameters, [%d], [rtp:%o]', index, rtp);
		if (!rtp)
		{
			logger.debug('applyCodecParameters, [%d], rtp is null, continue');
			index++;
			continue;
		}

		// Just in case.
		answerMediaObject.fmtp = answerMediaObject.fmtp || [];
		logger.debug('applyCodecParameters, [%d], [answerMediaObject.fmtp:%o]', index, answerMediaObject.fmtp);

		let fmtp = answerMediaObject.fmtp
			.find((f) => f.payload === codec.payloadType);

		logger.debug('applyCodecParameters, [%d], 1 [fmtp.fmtp:%o]', index, fmtp);

		if (!fmtp)
		{
			fmtp = { payload: codec.payloadType, config: '' };
			answerMediaObject.fmtp.push(fmtp);
		}
		logger.debug('applyCodecParameters, [%d], 2 [fmtp.fmtp:%o]', index, fmtp);

		const parameters = sdpTransform.parseParams(fmtp.config);
		logger.debug('applyCodecParameters, [%d], [parameters:%o]', index, parameters);

		switch (mimeType)
		{
			case 'audio/opus':
			{
				const spropStereo = codec.parameters['sprop-stereo'];
				logger.debug('applyCodecParameters, [%d], [spropStereo:%o]', index, spropStereo);

				if (spropStereo !== undefined)
					parameters.stereo = spropStereo ? 1 : 0;

				logger.debug('applyCodecParameters, [%d], [parameters.stereo:%o]', index, parameters.stereo);
				break;
			}
		}

		// Write the codec fmtp.config back.
		fmtp.config = '';

		let count = 0;
		for (const key of Object.keys(parameters))
		{
			if (fmtp.config)
				fmtp.config += ';';

			fmtp.config += `${key}=${parameters[key]}`;
			logger.debug('applyCodecParameters, [%d], [fmtp:%d][fmtp.config:%o]', index, count, fmtp.config);
			count++;
		}
		logger.debug('applyCodecParameters, last [%d], [parameters:%o]', index, parameters);
		index++;
	}
};
