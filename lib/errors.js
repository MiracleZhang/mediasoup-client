/**
 * Error indicating not support for something.
 */

 const Logger = require('./Logger');
 const logger = new Logger('LPZ Client Error');


class UnsupportedError extends Error
{
	constructor(message)
	{
		super(message);

		this.name = 'UnsupportedError';

		logger.debug('UnsupportedError, [message:%o]', message);

		if (Error.hasOwnProperty('captureStackTrace')) // Just in V8.
			Error.captureStackTrace(this, UnsupportedError);
		else
			this.stack = (new Error(message)).stack;
	}
}

/**
 * Error produced when calling a method in an invalid state.
 */
class InvalidStateError extends Error
{
	constructor(message)
	{
		super(message);

		this.name = 'InvalidtateError';

		logger.debug('InvalidStateError, [message:%o]', message);s

		if (Error.hasOwnProperty('captureStackTrace')) // Just in V8.
			Error.captureStackTrace(this, InvalidStateError);
		else
			this.stack = (new Error(message)).stack;
	}
}

module.exports =
{
	UnsupportedError,
	InvalidStateError
};
