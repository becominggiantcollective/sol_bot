/**
 * PRODUCTION-GRADE LOGGER WITH MONITORING
 * 
 * Features:
 * - Multi-level logging (error, warn, info, debug)
 * - Daily log rotation (keeps 14 days)
 * - Separate files for errors, combined logs, and performance metrics
 * - Memory usage tracking
 * - Performance metrics
 * - Structured JSON logging for analysis
 * - Console output with colors for development
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================

const LOG_DIR = process.env.LOG_DIR || './logs';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ============================================================================
// CUSTOM LOG FORMATS
// ============================================================================

const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0 && meta.metadata) {
      const filtered = Object.entries(meta.metadata)
        .filter(([k, v]) => v !== undefined && v !== null)
        .slice(0, 3); // Only show first 3 metadata items in console
      if (filtered.length > 0) {
        metaStr = ' ' + filtered.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
      }
    }
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// ============================================================================
// WINSTON TRANSPORTS
// ============================================================================

const transports: winston.transport[] = [
  // Error logs - separate file, rotated daily, kept for 30 days
  new DailyRotateFile({
    filename: path.join(LOG_DIR, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxFiles: '30d',
    maxSize: '20m',
    format: customFormat,
  }),

  // Combined logs - all levels, rotated daily, kept for 14 days
  new DailyRotateFile({
    filename: path.join(LOG_DIR, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    maxSize: '100m',
    format: customFormat,
  }),

  // Performance metrics - separate file for analysis
  new DailyRotateFile({
    filename: path.join(LOG_DIR, 'performance-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'info',
    maxFiles: '7d',
    maxSize: '50m',
    format: customFormat,
  }),
];

// Console output for development
if (NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: LOG_LEVEL,
    })
  );
} else {
  // In production, only show warn+ in console
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: 'warn',
    })
  );
}

// ============================================================================
// LOGGER INSTANCE
// ============================================================================

const logger = winston.createLogger({
  level: LOG_LEVEL,
  transports,
  exitOnError: false,
});

// ============================================================================
// PERFORMANCE MONITORING
// ============================================================================

interface PerformanceMetrics {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success?: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

const activeTimers = new Map<string, PerformanceMetrics>();

// ============================================================================
// MONITORING STATS
// ============================================================================

interface MonitoringStats {
  startTime: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalOpportunities: number;
  profitableOpportunities: number;
  totalProfit: number;
  memoryUsage: NodeJS.MemoryUsage;
  lastUpdated: number;
  uptime?: number;
}

const stats: MonitoringStats = {
  startTime: Date.now(),
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalOpportunities: 0,
  profitableOpportunities: 0,
  totalProfit: 0,
  memoryUsage: process.memoryUsage(),
  lastUpdated: Date.now(),
};

// Update memory usage every 30 seconds
setInterval(() => {
  stats.memoryUsage = process.memoryUsage();
  stats.lastUpdated = Date.now();
  
  // Log memory warning if usage is high
  const heapUsedMB = stats.memoryUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = stats.memoryUsage.heapTotal / 1024 / 1024;
  const usagePercent = (heapUsedMB / heapTotalMB) * 100;
  
  if (usagePercent > 80) {
    logger.warn('High memory usage detected', {
      heapUsedMB: heapUsedMB.toFixed(2),
      heapTotalMB: heapTotalMB.toFixed(2),
      usagePercent: usagePercent.toFixed(1),
    });
  }
}, 30000);

// ============================================================================
// ENHANCED LOGGER CLASS
// ============================================================================

export class AppLogger {
  private context: string;

  constructor(context: string = 'App') {
    this.context = context;
  }

  /**
   * Log debug information (disabled in production by default)
   */
  debug(message: string, meta?: Record<string, any>) {
    logger.debug(message, { context: this.context, ...meta });
  }

  /**
   * Log informational messages
   */
  info(message: string, meta?: Record<string, any>) {
    logger.info(message, { context: this.context, ...meta });
  }

  /**
   * Log warnings
   */
  warn(message: string, meta?: Record<string, any>) {
    logger.warn(message, { context: this.context, ...meta });
  }

  /**
   * Log errors with stack traces
   */
  error(message: string, error?: Error | any, meta?: Record<string, any>) {
    stats.failedRequests++;
    
    const errorMeta: Record<string, any> = {
      context: this.context,
      ...meta,
    };

    if (error instanceof Error) {
      errorMeta.error = error.message;
      errorMeta.stack = error.stack;
    } else if (error) {
      errorMeta.error = String(error);
    }

    logger.error(message, errorMeta);
  }

  /**
   * Start a performance timer
   */
  startTimer(name: string, meta?: Record<string, any>): string {
    const timerId = `${this.context}:${name}:${Date.now()}`;
    activeTimers.set(timerId, {
      name,
      startTime: Date.now(),
      metadata: meta,
    });
    return timerId;
  }

  /**
   * End a performance timer and log the duration
   */
  endTimer(timerId: string, success: boolean = true, meta?: Record<string, any>) {
    const timer = activeTimers.get(timerId);
    if (!timer) {
      this.warn('Timer not found', { timerId });
      return;
    }

    timer.endTime = Date.now();
    timer.duration = timer.endTime - timer.startTime;
    timer.success = success;

    const level = timer.duration > 5000 ? 'warn' : 'info';
    
    logger.log(level, `${timer.name} completed`, {
      context: this.context,
      duration: `${timer.duration}ms`,
      success,
      ...timer.metadata,
      ...meta,
    });

    activeTimers.delete(timerId);

    if (success) {
      stats.successfulRequests++;
    }
    stats.totalRequests++;
  }

  /**
   * Log opportunity detection
   */
  logOpportunity(type: string, profitable: boolean, details: Record<string, any>) {
    stats.totalOpportunities++;
    
    if (profitable) {
      stats.profitableOpportunities++;
      if (details.profit) {
        stats.totalProfit += details.profit;
      }
      
      logger.info(`💰 OPPORTUNITY: ${type}`, {
        context: this.context,
        type,
        profitable: true,
        ...details,
      });
    } else {
      logger.debug(`Opportunity detected but not profitable: ${type}`, {
        context: this.context,
        type,
        profitable: false,
        ...details,
      });
    }
  }

  /**
   * Log trade execution
   */
  logTrade(action: 'attempt' | 'success' | 'failure', details: Record<string, any>) {
    const level = action === 'failure' ? 'error' : 'info';
    
    logger.log(level, `🔄 TRADE ${action.toUpperCase()}`, {
      context: this.context,
      action,
      ...details,
    });
  }

  /**
   * Log RPC/API calls
   */
  logApiCall(service: string, endpoint: string, statusCode?: number, duration?: number, error?: any) {
    if (error) {
      this.error(`API call failed: ${service} ${endpoint}`, error, {
        service,
        endpoint,
        statusCode,
        duration,
      });
    } else {
      this.debug(`API call: ${service} ${endpoint}`, {
        service,
        endpoint,
        statusCode,
        duration,
      });
    }
  }

  /**
   * Log WebSocket events
   */
  logWebSocket(event: 'connect' | 'disconnect' | 'message' | 'error', details?: Record<string, any>) {
    const level = event === 'error' ? 'error' : 'info';
    logger.log(level, `WebSocket ${event}`, {
      context: this.context,
      event,
      ...details,
    });
  }

  /**
   * Get current monitoring statistics
   */
  getStats(): MonitoringStats {
    return {
      ...stats,
      uptime: Date.now() - stats.startTime,
      memoryUsage: process.memoryUsage(),
    };
  }

  /**
   * Log monitoring stats (call this periodically)
   */
  logStats() {
    const currentStats = this.getStats();
    const uptimeMinutes = Math.floor((currentStats.uptime || 0) / 60000);
    const memoryMB = (currentStats.memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
    const successRate = currentStats.totalRequests > 0
      ? ((currentStats.successfulRequests / currentStats.totalRequests) * 100).toFixed(1)
      : '0';

    logger.info('📊 MONITORING STATS', {
      context: this.context,
      uptime: `${uptimeMinutes}m`,
      totalRequests: currentStats.totalRequests,
      successRate: `${successRate}%`,
      opportunities: currentStats.totalOpportunities,
      profitable: currentStats.profitableOpportunities,
      totalProfit: currentStats.totalProfit.toFixed(4),
      memoryMB,
      heapTotal: (currentStats.memoryUsage.heapTotal / 1024 / 1024).toFixed(2),
      external: (currentStats.memoryUsage.external / 1024 / 1024).toFixed(2),
    });
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const createLogger = (context: string): AppLogger => {
  return new AppLogger(context);
};

// Default logger
export const log = new AppLogger('Bot');

// Export for backward compatibility
export default log;

// ============================================================================
// PROCESS MONITORING
// ============================================================================

// Log unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Promise Rejection', reason as Error, {
    promise: String(promise),
  });
});

process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception - shutting down', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down gracefully');
  log.logStats();
  setTimeout(() => process.exit(0), 1000);
});

process.on('SIGINT', () => {
  log.info('SIGINT received, shutting down gracefully');
  log.logStats();
  setTimeout(() => process.exit(0), 1000);
});

// Log stats every 5 minutes
setInterval(() => {
  log.logStats();
}, 5 * 60 * 1000);
