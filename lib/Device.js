const Logger = require('./Logger');
const { UnsupportedError, InvalidStateError } = require('./errors');
const detectDevice = require('./detectDevice');
const ortc = require('./ortc');
const Transport = require('./Transport');

const logger = new Logger('LPZ Client Device');

class Device
{
	/**
	 * Create a new Device to connect to mediasoup server.
	 *
	 * @param {Class} [Handler] - An optional RTC handler class for unsupported or
	 *   custom devices. Don't set it when in a browser.
	 *
	 * @throws {UnsupportedError} if device is not supported.
	 */
	constructor({ Handler } = {})
	{
		logger.debug('constructor, [Handler:%o] 1', Handler);

		// RTC handler class.
		this._Handler = Handler || detectDevice();

		logger.debug('constructor, [Handler:%o] 2', Handler);

		if (!this._Handler)
			throw new UnsupportedError('device not supported');

		logger.debug('constructor() [Handler:%s] 3', this._Handler.name);

		// Loaded flag.
		// @type {Boolean}
		this._loaded = false;

		// Extended RTP capabilities.
		// @type {Object}
		this._extendedRtpCapabilities = null;

		// Local RTP capabilities for receiving media.
		// @type {RTCRtpCapabilities}
		this._recvRtpCapabilities = null;

		// Whether we can produce audio/video based on computed extended RTP
		// capabilities.
		// @type {Object}
		this._canProduceByKind =
		{
			audio : false,
			video : false
		};
	}

	/**
	 * The RTC handler class name ('Chrome70', 'Firefox65', etc).
	 *
	 * @returns {String}
	 */
	get handlerName()
	{
		logger.debug('get handlerName, [this._Handler.name:%o]', this._Handler.name);
		return this._Handler.name;
	}

	/**
	 * Whether the Device is loaded.
	 *
	 * @returns {Boolean}
	 */
	get loaded()
	{
		logger.debug('get loaded, [this._loaded:%o]', this._loaded);
		return this._loaded;
	}

	/**
	 * RTP capabilities of the Device for receiving media.
	 *
	 * @returns {RTCRtpCapabilities}
	 * @throws {InvalidStateError} if not loaded.
	 */
	get rtpCapabilities()
	{
		logger.debug('get rtpCapabilities, [this._recvRtpCapabilities:%o]', this._recvRtpCapabilities);
		if (!this._loaded)
			throw new InvalidStateError('not loaded');

		return this._recvRtpCapabilities;
	}

	/**
	 * Initialize the Device.
	 *
	 * @param {RTCRtpCapabilities} routerRtpCapabilities - Router RTP capabilities.
	 *
	 * @async
	 * @throws {TypeError} if missing/wrong arguments.
	 * @throws {InvalidStateError} if not loaded.
	 */
	async load({ routerRtpCapabilities } = {})
	{
		logger.debug('load() [routerRtpCapabilities:%o]', routerRtpCapabilities);

		if (this._loaded)
			throw new InvalidStateError('already loaded');
		else if (typeof routerRtpCapabilities !== 'object')
			throw new TypeError('missing routerRtpCapabilities');

		const nativeRtpCapabilities = await this._Handler.getNativeRtpCapabilities();

		logger.debug(
			'load() | got native RTP capabilities:%o', nativeRtpCapabilities);

		// Get extended RTP capabilities.
		this._extendedRtpCapabilities = ortc.getExtendedRtpCapabilities(
			nativeRtpCapabilities, routerRtpCapabilities);

		logger.debug(
			'load() | got extended RTP capabilities:%o', this._extendedRtpCapabilities);

		// Check whether we can produce audio/video.
		this._canProduceByKind.audio =
			ortc.canSend('audio', this._extendedRtpCapabilities);
		this._canProduceByKind.video =
			ortc.canSend('video', this._extendedRtpCapabilities);

		logger.debug(
			'load() | [this._canProduceByKind:%o]', this._canProduceByKind);

		// Generate our receiving RTP capabilities for receiving media.
		this._recvRtpCapabilities =
			ortc.getRecvRtpCapabilities(this._extendedRtpCapabilities);

		logger.debug(
			'load() | got receiving RTP capabilities:%o', this._recvRtpCapabilities);

		logger.debug('load() succeeded');

		this._loaded = true;
	}

	/**
	 * Whether we can produce audio/video.
	 *
	 * @param {String} kind - 'audio' or 'video'.
	 *
	 * @returns {Boolean}
	 * @throws {InvalidStateError} if not loaded.
	 * @throws {TypeError} if wrong arguments.
	 */
	canProduce(kind)
	{
		logger.debug('canProduce, [kind:%o]', kind);
		if (!this._loaded)
			throw new InvalidStateError('not loaded');
		else if (kind !== 'audio' && kind !== 'video')
			throw new TypeError(`invalid kind "${kind}"`);

		return this._canProduceByKind[kind];
	}

	/**
	 * Creates a Transport for sending media.
	 *
	 * @param {String} - Server-side Transport id.
	 * @param {RTCIceParameters} iceParameters - Server-side Transport ICE parameters.
	 * @param {Array<RTCIceCandidate>} [iceCandidates] - Server-side Transport ICE candidates.
	 * @param {RTCDtlsParameters} dtlsParameters - Server-side Transport DTLS parameters.
	 * @param {Array<RTCIceServer>} [iceServers] - Array of ICE servers.
	 * @param {RTCIceTransportPolicy} [iceTransportPolicy] - ICE transport
	 *   policy.
	 * @param {Object} [proprietaryConstraints] - RTCPeerConnection proprietary constraints.
	 * @param {Object} [appData={}] - Custom app data.
	 *
	 * @returns {Transport}
	 * @throws {InvalidStateError} if not loaded.
	 * @throws {TypeError} if wrong arguments.
	 */
	createSendTransport(
		{
			id,
			iceParameters,
			iceCandidates,
			dtlsParameters,
			iceServers,
			iceTransportPolicy,
			proprietaryConstraints,
			appData = {}
		} = {}
	)
	{
		logger.debug('createSendTransport()');

		return this._createTransport(
			{
				direction : 'send',
				id,
				iceParameters,
				iceCandidates,
				dtlsParameters,
				iceServers,
				iceTransportPolicy,
				proprietaryConstraints,
				appData
			});
	}

	/**
	 * Creates a Transport for receiving media.
	 *
	 * @param {String} - Server-side Transport id.
	 * @param {RTCIceParameters} iceParameters - Server-side Transport ICE parameters.
	 * @param {Array<RTCIceCandidate>} [iceCandidates] - Server-side Transport ICE candidates.
	 * @param {RTCDtlsParameters} dtlsParameters - Server-side Transport DTLS parameters.
	 * @param {Array<RTCIceServer>} [iceServers] - Array of ICE servers.
	 * @param {RTCIceTransportPolicy} [iceTransportPolicy] - ICE transport
	 *   policy.
	 * @param {Object} [proprietaryConstraints] - RTCPeerConnection proprietary constraints.
	 * @param {Object} [appData={}] - Custom app data.
	 *
	 * @returns {Transport}
	 * @throws {InvalidStateError} if not loaded.
	 * @throws {TypeError} if wrong arguments.
	 */
	createRecvTransport(
		{
			id,
			iceParameters,
			iceCandidates,
			dtlsParameters,
			iceServers,
			iceTransportPolicy,
			proprietaryConstraints,
			appData = {}
		} = {}
	)
	{
		logger.debug('createRecvTransport()');

		return this._createTransport(
			{
				direction : 'recv',
				id,
				iceParameters,
				iceCandidates,
				dtlsParameters,
				iceServers,
				iceTransportPolicy,
				proprietaryConstraints,
				appData
			});
	}

	/**
	 * @private
	 */
	_createTransport(
		{
			direction,
			id,
			iceParameters,
			iceCandidates,
			dtlsParameters,
			iceServers,
			iceTransportPolicy,
			proprietaryConstraints,
			appData = {}
		}
	)
	{
		logger.debug('createTransport(), [direction:%o, id:%o, iceParameters:%o, ' +
			'iceCandidates:%o, dtlsParameters:%o, iceServers:%o, iceTransportPolicy:%o, ' +
			'proprietaryConstraints:%o, appData:%o]', direction, id, iceParameters, iceCandidates, dtlsParameters, iceServers,
				iceTransportPolicy, proprietaryConstraints, appData);

		if (!this._loaded)
			throw new InvalidStateError('not loaded');
		else if (typeof id !== 'string')
			throw new TypeError('missing id');
		else if (typeof iceParameters !== 'object')
			throw new TypeError('missing iceParameters');
		else if (!Array.isArray(iceCandidates))
			throw new TypeError('missing iceCandidates');
		else if (typeof dtlsParameters !== 'object')
			throw new TypeError('missing dtlsParameters');
		else if (appData && typeof appData !== 'object')
			throw new TypeError('if given, appData must be an object');

		logger.debug('createTransport(), [Handler:%o, extendedRtpCapabilities:%o, canProduceByKind:%o]',
			this._Handler, this._extendedRtpCapabilities, this._canProduceByKind);

		// Create a new Transport.
		const transport = new Transport(
			{
				direction,
				id,
				iceParameters,
				iceCandidates,
				dtlsParameters,
				iceServers,
				iceTransportPolicy,
				proprietaryConstraints,
				appData,
				Handler                 : this._Handler,
				extendedRtpCapabilities : this._extendedRtpCapabilities,
				canProduceByKind        : this._canProduceByKind
			});

		return transport;
	}
}

module.exports = Device;
