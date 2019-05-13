const Logger = require('./Logger');
const EnhancedEventEmitter = require('./EnhancedEventEmitter');
const { UnsupportedError, InvalidStateError } = require('./errors');

const logger = new Logger('LPZ Client Producer');

class Producer extends EnhancedEventEmitter
{
	/**
	 * @private
	 *
	 * @emits transportclose
	 * @emits trackended
	 * @emits {track: MediaStreamTrack} @replacetrack
	 * @emits {spatialLayer: String} @setmaxspatiallayer
	 * @emits @getstats
	 * @emits @close
	 */
	constructor({ id, localId, track, rtpParameters, appData })
	{
		logger.debug('constructor, [id:%o, localId:%o, rtpParameters:%o, appData:%o]', id, localId, rtpParameters, appData);
		super(logger);

		// Id.
		// @type {String}
		this._id = id;

		// Local id.
		// @type {String}
		this._localId = localId;

		// Closed flag.
		// @type {Boolean}
		this._closed = false;

		// Local track.
		// @type {MediaStreamTrack}
		this._track = track;

		// RTP parameters.
		// @type {RTCRtpParameters}
		this._rtpParameters = rtpParameters;

		// Paused flag.
		// @type {Boolean}
		this._paused = !track.enabled;

		// Video max spatial layer.
		// @type {Number|Undefined}
		this._maxSpatialLayer = undefined;

		// App custom data.
		// @type {Object}
		this._appData = appData;

		this._onTrackEnded = this._onTrackEnded.bind(this);

		this._handleTrack();
	}

	/**
	 * Producer id.
	 *
	 * @returns {String}
	 */
	get id()
	{
		logger.debug('get id, [id:%o]', this._id);
		return this._id;
	}

	/**
	 * Local id.
	 *
	 * @private
	 * @returns {String}
	 */
	get localId()
	{
		logger.debug('get localId, [localId:%o]', this._localId);
		return this._localId;
	}

	/**
	 * Whether the Producer is closed.
	 *
	 * @returns {Boolean}
	 */
	get closed()
	{
		logger.debug('get closed, [closed:%o]', this._closed);
		return this._closed;
	}

	/**
	 * Media kind.
	 *
	 * @returns {String}
	 */
	get kind()
	{
		logger.debug('get kind, [this._track.kind:%o]', this._track.kind);
		return this._track.kind;
	}

	/**
	 * The associated track.
	 *
	 * @returns {MediaStreamTrack}
	 */
	get track()
	{
		logger.debug('get track, [this._track:%o]', this._track);
		return this._track;
	}

	/**
	 * RTP parameters.
	 *
	 * @returns {RTCRtpParameters}
	 */
	get rtpParameters()
	{
		logger.debug('get rtpParameters, [this._rtpParameters:%o]', this._rtpParameters);
		return this._rtpParameters;
	}

	/**
	 * Whether the Producer is paused.
	 *
	 * @returns {Boolean}
	 */
	get paused()
	{
		logger.debug('get paused, [this._paused:%o]', this._paused);
		return this._paused;
	}

	/**
	 * Max spatial layer.
	 *
	 * @type {Number}
	 */
	get maxSpatialLayer()
	{
		logger.debug('get maxSpatialLayer, [this._maxSpatialLayer:%o]', this._maxSpatialLayer);
		return this._maxSpatialLayer;
	}

	/**
	 * App custom data.
	 *
	 * @returns {Object}
	 */
	get appData()
	{
		logger.debug('get appData, [this._appData:%o]', this._appData);
		return this._appData;
	}

	/**
	 * Invalid setter.
	 */
	set appData(appData) // eslint-disable-line no-unused-vars
	{
		throw new Error('cannot override appData object');
	}

	/**
	 * Closes the Producer.
	 */
	close()
	{
		if (this._closed)
			return;

		logger.debug('close()');

		this._closed = true;

		this._destroyTrack();

		this.emit('@close');
	}

	/**
	 * Transport was closed.
	 *
	 * @private
	 */
	transportClosed()
	{
		if (this._closed)
			return;

		logger.debug('transportClosed()');

		this._closed = true;

		this._destroyTrack();

		this.safeEmit('transportclose');
	}

	/**
	 * Get associated RTCRtpSender stats.
	 *
	 * @promise
	 * @returns {RTCStatsReport}
	 * @throws {InvalidStateError} if Producer closed.
	 */
	async getStats()
	{
		if (this._closed)
			throw new InvalidStateError('closed');

		return this.safeEmitAsPromise('@getstats');
	}

	/**
	 * Pauses sending media.
	 */
	pause()
	{
		logger.debug('pause()');

		if (this._closed)
		{
			logger.error('pause() | Producer closed');

			return;
		}

		this._paused = true;
		this._track.enabled = false;
	}

	/**
	 * Resumes sending media.
	 */
	resume()
	{
		logger.debug('resume()');

		if (this._closed)
		{
			logger.error('resume() | Producer closed');

			return;
		}

		this._paused = false;
		this._track.enabled = true;
	}

	/**
	 * Replaces the current track with a new one.
	 *
	 * @param {MediaStreamTrack} track - New track.
	 *
	 * @async
	 * @throws {InvalidStateError} if Producer closed or track ended.
	 * @throws {TypeError} if wrong arguments.
	 */
	async replaceTrack({ track } = {})
	{
		logger.debug('replaceTrack() [track:%o]', track);

		if (this._closed)
		{
			// This must be done here. Otherwise there is no chance to stop the given
			// track.
			try { track.stop(); }
			catch (error) {}

			throw new InvalidStateError('closed');
		}
		else if (!track)
		{
			throw new TypeError('missing track');
		}
		else if (track.readyState === 'ended')
		{
			throw new InvalidStateError('track ended');
		}

		await this.safeEmitAsPromise('@replacetrack', track);

		// Destroy the previous track.
		this._destroyTrack();

		// Set the new track.
		this._track = track;

		// If this Producer was paused/resumed and the state of the new
		// track does not match, fix it.
		if (!this._paused)
			this._track.enabled = true;
		else
			this._track.enabled = false;

		// Handle the effective track.
		this._handleTrack();
	}

	/**
	 * Sets the video max spatial layer to be sent.
	 *
	 * @param {Number} spatialLayer
	 *
	 * @async
	 * @throws {InvalidStateError} if Producer closed.
	 * @throws {UnsupportedError} if not a video Producer.
	 * @throws {TypeError} if wrong arguments.
	 */
	async setMaxSpatialLayer(spatialLayer)
	{
		logger.debug('setMaxSpatialLayer, [spatialLayer:%o]', spatialLayer);
		if (this._closed)
			throw new InvalidStateError('closed');
		else if (this._track.kind !== 'video')
			throw new UnsupportedError('not a video Producer');
		else if (typeof spatialLayer !== 'number')
			throw new TypeError('invalid spatialLayer');

		if (spatialLayer === this._maxSpatialLayer)
			return;

		await this.safeEmitAsPromise('@setmaxspatiallayer', spatialLayer);

		this._maxSpatialLayer = spatialLayer;
	}

	/**
	 * @private
	 */
	_onTrackEnded()
	{
		logger.debug('track "ended" event');

		this.safeEmit('trackended');
	}

	/**
	 * @private
	 */
	_handleTrack()
	{
		logger.debug('_handleTrack, addEventListener ended');
		this._track.addEventListener('ended', this._onTrackEnded);
	}

	/**
	 * @private
	 */
	_destroyTrack()
	{
		try
		{
			logger.debug('_destroyTrack, removeEventListener ended');
			this._track.removeEventListener('ended', this._onTrackEnded);
			this._track.stop();
		}
		catch (error)
		{}
	}
}

module.exports = Producer;
