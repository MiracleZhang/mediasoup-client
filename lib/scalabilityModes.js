const Logger = require('./Logger');
const logger = new Logger('LPZ Client ScalabilityModes');

const ScalabilityModeRegex = new RegExp('^L(\\d+)T(\\d+)');

exports.parse = function(scalabilityMode)
{
	logger.debug('parse, [scalabilityMode:%o]', scalabilityMode);
	const match = ScalabilityModeRegex.exec(scalabilityMode);

	logger.debug('parse, [match:%o]', match);

	if (!match)
	{
		logger.debug('parse, [spatialLayers = 1, temporalLayers = 1]');
		return { spatialLayers: 1, temporalLayers: 1 };
	}

	logger.debug('parse, [spatialLayers = %o, temporalLayers = %o]', Number(match[1]), Number(match[2]));
	
	return {
		spatialLayers  : Number(match[1]),
		temporalLayers : Number(match[2])
	};
};
