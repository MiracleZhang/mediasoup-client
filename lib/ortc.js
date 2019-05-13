const h264 = require('h264-profile-level-id');
const Logger = require('./Logger');
const logger = new Logger('LPZ Client Ortc');

/**
 * Generate extended RTP capabilities for sending and receiving.
 *
 * @param {RTCRtpCapabilities} localCaps - Local capabilities.
 * @param {RTCRtpCapabilities} remoteCaps - Remote capabilities.
 *
 * @returns {RTCExtendedRtpCapabilities}
 */
exports.getExtendedRtpCapabilities = function(localCaps, remoteCaps)
{
	logger.debug('getExtendedRtpCapabilities, [localCaps:%o, remoteCaps:%o]', localCaps, remoteCaps);
	const extendedRtpCapabilities =
	{
		codecs           : [],
		headerExtensions : [],
		fecMechanisms    : []
	};

	logger.debug('getExtendedRtpCapabilities, [extendedRtpCapabilities:%o]', extendedRtpCapabilities);

	let index = 0;
	// Match media codecs and keep the order preferred by remoteCaps.
	for (const remoteCodec of remoteCaps.codecs || [])
	{
		logger.debug('getExtendedRtpCapabilities, [%d], [remoteCodec:%o]', index, remoteCodec);
		if (/.+\/rtx$/i.test(remoteCodec.mimeType))
		{
			index++;
			continue;
		}

		const matchingLocalCodec = (localCaps.codecs || [])
			.find((localCodec) => (
				matchCodecs(localCodec, remoteCodec, { strict: true, modify: true }))
			);

		logger.debug('getExtendedRtpCapabilities, [%d], [matchingLocalCodec:%o]', index, matchingLocalCodec);
		if (matchingLocalCodec)
		{
			const extendedCodec =
			{
				mimeType             : matchingLocalCodec.mimeType,
				kind                 : matchingLocalCodec.kind,
				clockRate            : matchingLocalCodec.clockRate,
				localPayloadType     : matchingLocalCodec.preferredPayloadType,
				localRtxPayloadType  : null,
				remotePayloadType    : remoteCodec.preferredPayloadType,
				remoteRtxPayloadType : null,
				channels             : matchingLocalCodec.channels,
				rtcpFeedback         : reduceRtcpFeedback(matchingLocalCodec, remoteCodec),
				localParameters      : matchingLocalCodec.parameters || {},
				remoteParameters     : remoteCodec.parameters || {}
			};

			logger.debug('getExtendedRtpCapabilities, [%d], [extendedCodec:%o]', index, extendedCodec);
			if (!extendedCodec.channels)
				delete extendedCodec.channels;

			extendedRtpCapabilities.codecs.push(extendedCodec);
			index++;
		}
	}

	index = 0;
	// Match RTX codecs.
	for (const extendedCodec of extendedRtpCapabilities.codecs || [])
	{
		logger.debug('getExtendedRtpCapabilities, [%d], [extendedCodec:%o]', index, extendedCodec);
		const matchingLocalRtxCodec = (localCaps.codecs || [])
			.find((localCodec) => (
				/.+\/rtx$/i.test(localCodec.mimeType) &&
				localCodec.parameters.apt === extendedCodec.localPayloadType
			));
			
		logger.debug('getExtendedRtpCapabilities, [%d], [matchingLocalRtxCodec:%o]', index, matchingLocalRtxCodec);
		
		const matchingRemoteRtxCodec = (remoteCaps.codecs || [])
			.find((remoteCodec) => (
				/.+\/rtx$/i.test(remoteCodec.mimeType) &&
				remoteCodec.parameters.apt === extendedCodec.remotePayloadType
			));

		logger.debug('getExtendedRtpCapabilities, [%d], [matchingRemoteRtxCodec:%o]', index, matchingRemoteRtxCodec);

		if (matchingLocalRtxCodec && matchingRemoteRtxCodec)
		{
			extendedCodec.localRtxPayloadType = matchingLocalRtxCodec.preferredPayloadType;
			extendedCodec.remoteRtxPayloadType = matchingRemoteRtxCodec.preferredPayloadType;
		}
		logger.debug('getExtendedRtpCapabilities, [%d], [localRtxPayloadType:%o, remoteRtxPayloadType:%o]',
			index, extendedCodec.localRtxPayloadType, extendedCodec.remoteRtxPayloadType);

		index++;
	}

	index = 0;
	// Match header extensions.
	for (const remoteExt of remoteCaps.headerExtensions || [])
	{
		logger.debug('getExtendedRtpCapabilities, [%d], [remoteExt:%o]', index, remoteExt);
		const matchingLocalExt = (localCaps.headerExtensions || [])
			.find((localExt) => matchHeaderExtensions(localExt, remoteExt));

		logger.debug('getExtendedRtpCapabilities, [%d], [matchingLocalExt:%o]', index, matchingLocalExt);
		if (matchingLocalExt)
		{
			const extendedExt =
			{
				kind      : remoteExt.kind,
				uri       : remoteExt.uri,
				sendId    : matchingLocalExt.preferredId,
				recvId    : remoteExt.preferredId,
				direction : 'sendrecv'
			};

			switch (remoteExt.direction)
			{
				case 'recvonly':
					extendedExt.direction = 'sendonly';
					break;
				case 'sendonly':
					extendedExt.direction = 'recvonly';
					break;
				case 'inactive':
					extendedExt.direction = 'inactive';
					break;
				default:
					extendedExt.direction = 'sendrecv';
			}

			logger.debug('getExtendedRtpCapabilities, [%d], [extendedExt:%o]', index, extendedExt);
			extendedRtpCapabilities.headerExtensions.push(extendedExt);
			index++;
		}
	}

	logger.debug('getExtendedRtpCapabilities, return [extendedRtpCapabilities:%o]', extendedRtpCapabilities);
	return extendedRtpCapabilities;
};

/**
 * Generate RTP capabilities for receiving media based on the given extended
 * RTP capabilities.
 *
 * @param {RTCExtendedRtpCapabilities} extendedRtpCapabilities
 *
 * @returns {RTCRtpCapabilities}
 */
exports.getRecvRtpCapabilities = function(extendedRtpCapabilities)
{
	logger.debug('getRecvRtpCapabilities, [extendedRtpCapabilities:%o]', extendedRtpCapabilities);
	const rtpCapabilities =
	{
		codecs           : [],
		headerExtensions : [],
		fecMechanisms    : []
	};

	logger.debug('getRecvRtpCapabilities, [rtpCapabilities:%o]', rtpCapabilities);

	let index = 0;
	for (const extendedCodec of extendedRtpCapabilities.codecs)
	{
		logger.debug('getRecvRtpCapabilities, [%d], [extendedCodec:%o]', index, extendedCodec);
		const codec =
		{
			mimeType             : extendedCodec.mimeType,
			kind                 : extendedCodec.kind,
			clockRate            : extendedCodec.clockRate,
			preferredPayloadType : extendedCodec.remotePayloadType,
			channels             : extendedCodec.channels,
			rtcpFeedback         : extendedCodec.rtcpFeedback,
			parameters           : extendedCodec.localParameters
		};

		logger.debug('getRecvRtpCapabilities, [%d], [codec:%o]', index, codec);
		if (!codec.channels)
			delete codec.channels;

		rtpCapabilities.codecs.push(codec);

		// Add RTX codec.
		if (extendedCodec.remoteRtxPayloadType)
		{
			logger.debug('getRecvRtpCapabilities, [%d], [extendedCodec.remoteRtxPayloadType:%o]', index, extendedCodec.remoteRtxPayloadType);
			const extendedRtxCodec =
			{
				mimeType             : `${extendedCodec.kind}/rtx`,
				kind                 : extendedCodec.kind,
				clockRate            : extendedCodec.clockRate,
				preferredPayloadType : extendedCodec.remoteRtxPayloadType,
				rtcpFeedback         : [],
				parameters           :
				{
					apt : extendedCodec.remotePayloadType
				}
			};

			logger.debug('getRecvRtpCapabilities, [%d], [extendedRtxCodec:%o]', index, extendedRtxCodec);
			rtpCapabilities.codecs.push(extendedRtxCodec);
			index++;
		}
	}

	index = 0;
	for (const extendedExtension of extendedRtpCapabilities.headerExtensions)
	{
		logger.debug('getRecvRtpCapabilities, [%d], [extendedExtension:%o]', index, extendedExtension);
		// Ignore RTP extensions not valid for receiving.
		if (
			extendedExtension.direction !== 'sendrecv' &&
			extendedExtension.direction !== 'recvonly'
		)
		{
			index++;
			continue;
		}

		const ext =
		{
			kind        : extendedExtension.kind,
			uri         : extendedExtension.uri,
			preferredId : extendedExtension.recvId
		};

		logger.debug('getRecvRtpCapabilities, [%d], [ext:%o]', index, ext);
		rtpCapabilities.headerExtensions.push(ext);
		index++;
	}

	rtpCapabilities.fecMechanisms = extendedRtpCapabilities.fecMechanisms;

	logger.debug('getRecvRtpCapabilities, return [rtpCapabilities:%o]', rtpCapabilities);
	return rtpCapabilities;
};

/**
 * Generate RTP parameters of the given kind for sending media.
 * Just the first media codec per kind is considered.
 * NOTE: mid, encodings and rtcp fields are left empty.
 *
 * @param {kind} kind
 * @param {RTCExtendedRtpCapabilities} extendedRtpCapabilities
 *
 * @returns {RTCRtpParameters}
 */
exports.getSendingRtpParameters = function(kind, extendedRtpCapabilities)
{
	logger.debug('getSendingRtpParameters, [kind:%o, extendedRtpCapabilities:%o]', kind, extendedRtpCapabilities);
	const rtpParameters =
	{
		mid              : null,
		codecs           : [],
		headerExtensions : [],
		encodings        : [],
		rtcp             : {}
	};

	let index = 0;
	for (const extendedCodec of extendedRtpCapabilities.codecs)
	{
		logger.debug('getRecvRtpCapabilities, [%d], [extendedCodec:%o]', index, extendedCodec);
		if (extendedCodec.kind !== kind)
		{
			index++;
			continue;
		}

		const codec =
		{
			mimeType     : extendedCodec.mimeType,
			clockRate    : extendedCodec.clockRate,
			payloadType  : extendedCodec.localPayloadType,
			channels     : extendedCodec.channels,
			rtcpFeedback : extendedCodec.rtcpFeedback,
			parameters   : extendedCodec.localParameters
		};

		logger.debug('getRecvRtpCapabilities, [%d], [codec:%o]', index, codec);
		if (!codec.channels)
			delete codec.channels;

		rtpParameters.codecs.push(codec);

		// Add RTX codec.
		if (extendedCodec.localRtxPayloadType)
		{
			logger.debug('getRecvRtpCapabilities, [%d], [extendedCodec.localRtxPayloadType:%o]', index, extendedCodec.localRtxPayloadType);
			const rtxCodec =
			{
				mimeType     : `${extendedCodec.kind}/rtx`,
				clockRate    : extendedCodec.clockRate,
				payloadType  : extendedCodec.localRtxPayloadType,
				rtcpFeedback : [],
				parameters   :
				{
					apt : extendedCodec.localPayloadType
				}
			};

			logger.debug('getRecvRtpCapabilities, [%d], [rtxCodec:%o]', index, rtxCodec);
			rtpParameters.codecs.push(rtxCodec);
		}

		// NOTE: We assume a single media codec plus an optional RTX codec.
		index++;
		break;
	}

	index = 0;
	for (const extendedExtension of extendedRtpCapabilities.headerExtensions)
	{
		logger.debug('getRecvRtpCapabilities, [%d], [extendedExtension:%o]', index, extendedExtension);
		// Ignore RTP extensions of a different kind and those not valid for sending.
		if (
			(extendedExtension.kind && extendedExtension.kind !== kind) ||
			(
				extendedExtension.direction !== 'sendrecv' &&
				extendedExtension.direction !== 'sendonly'
			)
		)
		{
			index++;
			continue;
		}

		const ext =
		{
			uri : extendedExtension.uri,
			id  : extendedExtension.sendId
		};

		logger.debug('getRecvRtpCapabilities, [%d], [ext:%o]', index, ext);
		rtpParameters.headerExtensions.push(ext);
		index++;
	}

	logger.debug('getRecvRtpCapabilities, return [rtpParameters:%o]', rtpParameters);
	return rtpParameters;
};

/**
 * Generate RTP parameters of the given kind suitable for the remote SDP answer.
 *
 * @param {kind} kind
 * @param {RTCExtendedRtpCapabilities} extendedRtpCapabilities
 *
 * @returns {RTCRtpParameters}
 */
exports.getSendingRemoteRtpParameters = function(kind, extendedRtpCapabilities)
{
	logger.debug('getSendingRemoteRtpParameters, [kind:%o, extendedRtpCapabilities:%o]', kind, extendedRtpCapabilities);
	const rtpParameters =
	{
		mid              : null,
		codecs           : [],
		headerExtensions : [],
		encodings        : [],
		rtcp             : {}
	};

	logger.debug('getSendingRemoteRtpParameters, [rtpParameters:%o]', rtpParameters);

	let index = 0;
	for (const extendedCodec of extendedRtpCapabilities.codecs)
	{
		logger.debug('getSendingRemoteRtpParameters, [%d], [extendedCodec:%o]', index, extendedCodec);
		if (extendedCodec.kind !== kind)
		{
			index++;
			continue;
		}

		const codec =
		{
			mimeType     : extendedCodec.mimeType,
			clockRate    : extendedCodec.clockRate,
			payloadType  : extendedCodec.localPayloadType,
			channels     : extendedCodec.channels,
			rtcpFeedback : extendedCodec.rtcpFeedback,
			parameters   : extendedCodec.remoteParameters
		};

		logger.debug('getSendingRemoteRtpParameters, [%d], [codec:%o]', index, codec);
		if (!codec.channels)
			delete codec.channels;

		rtpParameters.codecs.push(codec);

		// Add RTX codec.
		if (extendedCodec.localRtxPayloadType)
		{
			const rtxCodec =
			{
				mimeType     : `${extendedCodec.kind}/rtx`,
				clockRate    : extendedCodec.clockRate,
				payloadType  : extendedCodec.localRtxPayloadType,
				rtcpFeedback : [],
				parameters   :
				{
					apt : extendedCodec.localPayloadType
				}
			};

			logger.debug('getSendingRemoteRtpParameters, [%d], [rtxCodec:%o]', index, rtxCodec);
			rtpParameters.codecs.push(rtxCodec);
		}

		// NOTE: We assume a single media codec plus an optional RTX codec.
		index++;
		break;
	}

	index = 0;
	for (const extendedExtension of extendedRtpCapabilities.headerExtensions)
	{
		logger.debug('getSendingRemoteRtpParameters, [%d], [extendedExtension:%o]', index, extendedExtension);
		// Ignore RTP extensions of a different kind and those not valid for sending.
		if (
			(extendedExtension.kind && extendedExtension.kind !== kind) ||
			(
				extendedExtension.direction !== 'sendrecv' &&
				extendedExtension.direction !== 'sendonly'
			)
		)
		{
			index++;
			continue;
		}

		const ext =
		{
			uri : extendedExtension.uri,
			id  : extendedExtension.sendId
		};

		logger.debug('getSendingRemoteRtpParameters, [%d], [ext:%o]', index, ext);
		rtpParameters.headerExtensions.push(ext);
		index++;
	}

	// Reduce codecs' RTCP feedback. Use Transport-CC if available, REMB otherwise.
	if (
		rtpParameters.headerExtensions.some((ext) => (
			ext.uri === 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01'
		))
	)
	{
		logger.debug('getSendingRemoteRtpParameters, rtpParameters.headerExtensions.some, http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01');
		let index = 0;
		for (const codec of rtpParameters.codecs)
		{
			codec.rtcpFeedback = (codec.rtcpFeedback || [])
				.filter((fb) => fb.type !== 'goog-remb');
			logger.debug('getSendingRemoteRtpParameters, rtcpFeedback, goog-remb, [%d], [codec:%o]', index, codec);
			index++;
		}
	}
	else if (
		rtpParameters.headerExtensions.some((ext) => (
			ext.uri === 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
		))
	)
	{
		logger.debug('getSendingRemoteRtpParameters, rtpParameters.headerExtensions.some, http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time');
		let index = 0;
		for (const codec of rtpParameters.codecs)
		{
			codec.rtcpFeedback = (codec.rtcpFeedback || [])
				.filter((fb) => fb.type !== 'transport-cc');
			logger.debug('getSendingRemoteRtpParameters, rtcpFeedback, transport-cc, [%d], [codec:%o]', index, codec);
			index++;
		}
	}
	else
	{
		let index = 0;
		for (const codec of rtpParameters.codecs)
		{
			codec.rtcpFeedback = (codec.rtcpFeedback || [])
				.filter((fb) => (
					fb.type !== 'transport-cc' &&
					fb.type !== 'goog-remb'
				));
			logger.debug('getSendingRemoteRtpParameters, rtcpFeedback, [%d], [codec:%o]', index, codec);
			index++;
		}
	}

	logger.debug('getSendingRemoteRtpParameters, return [rtpParameters:%o]', rtpParameters);
	return rtpParameters;
};

/**
 * Whether media can be sent based on the given RTP capabilities.
 *
 * @param {String} kind
 * @param {RTCExtendedRtpCapabilities} extendedRtpCapabilities
 *
 * @returns {Boolean}
 */
exports.canSend = function(kind, extendedRtpCapabilities)
{
	logger.debug('canSend, [kind:%o, extendedRtpCapabilities:%o]', kind, extendedRtpCapabilities);
	logger.debug('canSend, return %o', extendedRtpCapabilities.codecs.some((codec) => codec.kind === kind));
	return extendedRtpCapabilities.codecs.
		some((codec) => codec.kind === kind);
};

/**
 * Whether the given RTP parameters can be received with the given RTP
 * capabilities.
 *
 * @param {RTCRtpParameters} rtpParameters
 * @param {RTCExtendedRtpCapabilities} extendedRtpCapabilities
 *
 * @returns {Boolean}
 */
exports.canReceive = function(rtpParameters, extendedRtpCapabilities)
{
	logger.debug('canReceive, [rtpParameters:%o, extendedRtpCapabilities:%o]', rtpParameters, extendedRtpCapabilities);
	if (rtpParameters.codecs.length === 0)
		return false;

	const firstMediaCodec = rtpParameters.codecs[0];

	logger.debug('canReceive, [firstMediaCodec:%o]', firstMediaCodec);
	return extendedRtpCapabilities.codecs
		.some((codec) => codec.remotePayloadType === firstMediaCodec.payloadType);
};

function matchCodecs(aCodec, bCodec, { strict = false, modify = false } = {})
{
	logger.debug('matchCodecs, [aCodec:%o, bCodec:%o, strict:%o, modify:%o]', aCodec, bCodec, strict, modify);
	const aMimeType = aCodec.mimeType.toLowerCase();
	const bMimeType = bCodec.mimeType.toLowerCase();

	logger.debug('matchCodecs, [aMimeType:%o, bMimeType:%o]', aMimeType, bMimeType);
	if (aMimeType !== bMimeType)
	{
		logger.debug('matchCodecs, return 1');
		return false;
	}

	if (aCodec.clockRate !== bCodec.clockRate)
	{
		logger.debug('matchCodecs, return 2');
		return false;
	}

	if (
		/^audio\/.+$/i.test(aMimeType) &&
		(
			(aCodec.channels !== undefined && aCodec.channels !== 1) ||
			(bCodec.channels !== undefined && bCodec.channels !== 1)
		) &&
		aCodec.channels !== bCodec.channels
	)
	{
		logger.debug('matchCodecs, return 3');
		return false;
	}

	// Per codec special checks.
	switch (aMimeType)
	{
		case 'video/h264':
		{
			const aPacketizationMode = (aCodec.parameters || {})['packetization-mode'] || 0;
			const bPacketizationMode = (bCodec.parameters || {})['packetization-mode'] || 0;

			logger.debug('matchCodecs, video/h264, [aPacketizationMode:%o, bPacketizationMode:%o]', aPacketizationMode, bPacketizationMode);
			if (aPacketizationMode !== bPacketizationMode)
			{
				logger.debug('matchCodecs, return 4');
				return false;
			}

			// If strict matching check profile-level-id.
			if (strict)
			{
				logger.debug('matchCodecs, strict = true');
				if (!h264.isSameProfile(aCodec.parameters, bCodec.parameters))
				{
					logger.debug('matchCodecs, return 5');
					return false;
				}

				let selectedProfileLevelId;

				try
				{
					selectedProfileLevelId =
						h264.generateProfileLevelIdForAnswer(aCodec.parameters, bCodec.parameters);
					logger.debug('matchCodecs, [selectedProfileLevelId:%o]', selectedProfileLevelId);
				}
				catch (error)
				{
					return false;
				}

				if (modify)
				{
					aCodec.parameters = aCodec.parameters || {};

					logger.debug('matchCodecs, [modify:%o, aCodec.parameters:%o]', modify, aCodec.parameters);
					if (selectedProfileLevelId)
						aCodec.parameters['profile-level-id'] = selectedProfileLevelId;
					else
						delete aCodec.parameters['profile-level-id'];
					logger.debug('matchCodecs, [modify:%o, aCodec:%o]', modify, aCodec);
				}
			}

			break;
		}
	}

	return true;
}

function matchHeaderExtensions(aExt, bExt)
{
	logger.debug('matchHeaderExtensions, [aExt:%o, bExt:%o]', aExt, bExt);
	if (aExt.kind && bExt.kind && aExt.kind !== bExt.kind)
		return false;

	if (aExt.uri !== bExt.uri)
		return false;

	return true;
}

function reduceRtcpFeedback(codecA, codecB)
{
	logger.debug('reduceRtcpFeedback, [codecA:%o, codecB:%o]', codecA, codecB);
	const reducedRtcpFeedback = [];

	let index = 0;
	for (const aFb of codecA.rtcpFeedback || [])
	{
		logger.debug('reduceRtcpFeedback, [%d], [aFb:%o]', index, aFb);
		const matchingBFb = (codecB.rtcpFeedback || [])
			.find((bFb) => (
				bFb.type === aFb.type &&
				(bFb.parameter === aFb.parameter || (!bFb.parameter && !aFb.parameter))
			));

		logger.debug('reduceRtcpFeedback, [%d], [matchingBFb:%o]', index, matchingBFb);
		if (matchingBFb)
			reducedRtcpFeedback.push(matchingBFb);

		index++;
	}

	logger.debug('reduceRtcpFeedback, [reducedRtcpFeedback:%o]', reducedRtcpFeedback);
	return reducedRtcpFeedback;
}
