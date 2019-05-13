const { EventEmitter } = require('events');
const Logger = require('./Logger');

class EnhancedEventEmitter extends EventEmitter
{
	constructor(logger)
	{
		super();
		this.setMaxListeners(Infinity);

		this._logger = logger || new Logger('LPZ Client EnhancedEventEmitter');
	}

	safeEmit(event, ...args)
	{
		this._logger.debug('safeEmit, [event:%o]', event);
		try
		{
			this.emit(event, ...args);
		}
		catch (error)
		{
			this._logger.error(
				'safeEmit() | event listener threw an error [event:%s]:%o',
				event, error);
		}
	}

	async safeEmitAsPromise(event, ...args)
	{
		return new Promise((resolve, reject) =>
		{
			this._logger.debug('safeEmitAsPromise, [event:%o]', event);
			this.safeEmit(event, ...args, resolve, reject);
		});
	}
}

module.exports = EnhancedEventEmitter;
