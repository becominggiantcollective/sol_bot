import { EventEmitter } from 'events';

export interface PriceUpdate {
  token: string;
  price: number;
  change24h: number;
  volume24h: number;
  timestamp: number;
}

export interface OpportunityEvent {
  route: string;
  spread: number;
  profit: number;
  status: 'detected' | 'executing' | 'success' | 'failed';
  timestamp: number;
  error?: string;
}

export interface BotStatus {
  running: boolean;
  uptime: number;
  totalAttempts: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: number;
  lastActivity: string;
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'success' | 'debug';
  message: string;
  timestamp: number;
  data?: any;
}

export interface SettingsUpdate {
  key: string;
  value: string | number;
}

/**
 * Central event emitter for dashboard communication
 * Allows bot components to emit events that dashboard listens to
 */
class DashboardEvents extends EventEmitter {
  private static instance: DashboardEvents;
  private botStatus: BotStatus = {
    running: false,
    uptime: 0,
    totalAttempts: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalProfit: 0,
    lastActivity: 'Initializing...',
  };
  private startTime: number = 0;

  private constructor() {
    super();
    this.setMaxListeners(50); // Support multiple dashboard connections
  }

  static getInstance(): DashboardEvents {
    if (!DashboardEvents.instance) {
      DashboardEvents.instance = new DashboardEvents();
    }
    return DashboardEvents.instance;
  }

  // Bot control
  setBotRunning(running: boolean) {
    this.botStatus.running = running;
    if (running) {
      this.startTime = Date.now();
    }
    this.emit('bot:status', this.getStatus());
  }

  // Price updates
  emitPriceUpdate(update: PriceUpdate) {
    this.emit('price:update', update);
  }

  // Opportunity detection and execution
  emitOpportunityDetected(route: string, spread: number, profit: number) {
    this.botStatus.totalAttempts++;
    this.botStatus.lastActivity = `Detected: ${route} (+${spread.toFixed(3)}%)`;
    
    const event: OpportunityEvent = {
      route,
      spread,
      profit,
      status: 'detected',
      timestamp: Date.now(),
    };
    
    this.emit('opportunity:detected', event);
    this.emit('bot:status', this.getStatus());
  }

  emitOpportunityExecuting(route: string, spread: number, profit: number) {
    this.botStatus.lastActivity = `Executing: ${route}`;
    
    const event: OpportunityEvent = {
      route,
      spread,
      profit,
      status: 'executing',
      timestamp: Date.now(),
    };
    
    this.emit('opportunity:executing', event);
    this.emit('bot:status', this.getStatus());
  }

  emitTradeSuccess(route: string, spread: number, profit: number) {
    this.botStatus.successfulTrades++;
    this.botStatus.totalProfit += profit;
    this.botStatus.lastActivity = `✅ Success: ${route} (+${profit.toFixed(4)} SOL)`;
    
    const event: OpportunityEvent = {
      route,
      spread,
      profit,
      status: 'success',
      timestamp: Date.now(),
    };
    
    this.emit('opportunity:success', event);
    this.emit('bot:status', this.getStatus());
    this.emitLog('success', `Trade executed successfully: ${route}`, { profit, spread });
  }

  emitTradeFailed(route: string, spread: number, profit: number, error: string) {
    this.botStatus.failedTrades++;
    this.botStatus.lastActivity = `❌ Failed: ${route} (${error})`;
    
    const event: OpportunityEvent = {
      route,
      spread,
      profit,
      status: 'failed',
      timestamp: Date.now(),
      error,
    };
    
    this.emit('opportunity:failed', event);
    this.emit('bot:status', this.getStatus());
    this.emitLog('error', `Trade failed: ${route}`, { error, spread });
  }

  // Logging
  emitLog(level: LogEntry['level'], message: string, data?: any) {
    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      data,
    };
    this.emit('log', entry);
  }

  // Settings updates
  emitSettingsUpdate(key: string, value: string | number) {
    this.emit('settings:update', { key, value });
    this.emitLog('info', `Settings updated: ${key} = ${value}`);
  }

  // Status getter
  getStatus(): BotStatus {
    if (this.botStatus.running && this.startTime > 0) {
      this.botStatus.uptime = Math.floor((Date.now() - this.startTime) / 1000);
    }
    return { ...this.botStatus };
  }

  // Reset statistics
  resetStats() {
    this.botStatus.totalAttempts = 0;
    this.botStatus.successfulTrades = 0;
    this.botStatus.failedTrades = 0;
    this.botStatus.totalProfit = 0;
    this.emit('bot:status', this.getStatus());
    this.emitLog('info', 'Statistics reset');
  }
}

export const dashboardEvents = DashboardEvents.getInstance();
