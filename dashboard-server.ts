import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { dashboardEvents } from './src/monitoring/dashboard-events';
import { SolanaArbitrageBot } from './src/index';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.DASHBOARD_PORT || 3000;

let bot: SolanaArbitrageBot | null = null;
let botStartPromise: Promise<void> | null = null;

// Serve dashboard HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API: Get current bot status
app.get('/api/status', (req, res) => {
  res.json(dashboardEvents.getStatus());
});

// API: Get environment settings
app.get('/api/settings', (req, res) => {
  try {
    const envPath = path.join(__dirname, '.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    
    const settings: any = {};
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          settings[key.trim()] = valueParts.join('=').trim();
        }
      }
    });
    
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

// API: Update environment setting
app.post('/api/settings', (req, res) => {
  try {
    const { key, value } = req.body;
    
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Key and value required' });
    }
    
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');
    
    // Update or add the setting
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
    
    fs.writeFileSync(envPath, envContent);
    
    // Update process.env
    process.env[key] = value;
    
    dashboardEvents.emitSettingsUpdate(key, value);
    
    res.json({ success: true, key, value });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// API: Start bot
app.post('/api/bot/start', async (req, res) => {
  try {
    if (bot && dashboardEvents.getStatus().running) {
      return res.status(400).json({ error: 'Bot is already running' });
    }
    
    dashboardEvents.emitLog('info', '🚀 Starting bot...');
    dashboardEvents.setBotRunning(true);
    
    // Create new bot instance
    bot = new SolanaArbitrageBot();
    
    // Start bot in background
    botStartPromise = bot.start().catch(error => {
      dashboardEvents.emitLog('error', `Bot error: ${error.message}`);
      dashboardEvents.setBotRunning(false);
    });
    
    res.json({ success: true, message: 'Bot started' });
  } catch (error: any) {
    dashboardEvents.emitLog('error', `Failed to start bot: ${error.message}`);
    dashboardEvents.setBotRunning(false);
    res.status(500).json({ error: error.message });
  }
});

// API: Stop bot
app.post('/api/bot/stop', async (req, res) => {
  try {
    if (!bot || !dashboardEvents.getStatus().running) {
      return res.status(400).json({ error: 'Bot is not running' });
    }
    
    dashboardEvents.emitLog('info', '🛑 Stopping bot...');
    
    // Stop the bot
    if (bot && typeof (bot as any).stop === 'function') {
      await (bot as any).stop();
    }
    
    bot = null;
    botStartPromise = null;
    dashboardEvents.setBotRunning(false);
    
    res.json({ success: true, message: 'Bot stopped' });
  } catch (error: any) {
    dashboardEvents.emitLog('error', `Failed to stop bot: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// API: Reset statistics
app.post('/api/bot/reset-stats', (req, res) => {
  dashboardEvents.resetStats();
  res.json({ success: true, message: 'Statistics reset' });
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Dashboard client connected:', socket.id);
  dashboardEvents.emitLog('info', 'Dashboard connected');
  
  // Send current status immediately
  socket.emit('bot:status', dashboardEvents.getStatus());
  
  // Forward all events to this socket
  const forwardEvent = (eventName: string) => {
    return (...args: any[]) => socket.emit(eventName, ...args);
  };
  
  const events = [
    'bot:status',
    'price:update',
    'opportunity:detected',
    'opportunity:executing',
    'opportunity:success',
    'opportunity:failed',
    'log',
    'settings:update',
  ];
  
  events.forEach(eventName => {
    dashboardEvents.on(eventName, forwardEvent(eventName));
  });
  
  // Cleanup on disconnect
  socket.on('disconnect', () => {
    console.log('Dashboard client disconnected:', socket.id);
    events.forEach(eventName => {
      dashboardEvents.off(eventName, forwardEvent(eventName));
    });
  });
  
  // Handle client commands
  socket.on('bot:start', async () => {
    try {
      if (bot && dashboardEvents.getStatus().running) {
        socket.emit('error', 'Bot is already running');
        return;
      }
      
      dashboardEvents.emitLog('info', '🚀 Starting bot...');
      dashboardEvents.setBotRunning(true);
      
      bot = new SolanaArbitrageBot();
      botStartPromise = bot.start().catch(error => {
        dashboardEvents.emitLog('error', `Bot error: ${error.message}`);
        dashboardEvents.setBotRunning(false);
      });
      
      socket.emit('bot:started');
    } catch (error: any) {
      dashboardEvents.emitLog('error', `Failed to start bot: ${error.message}`);
      dashboardEvents.setBotRunning(false);
      socket.emit('error', error.message);
    }
  });
  
  socket.on('bot:stop', async () => {
    try {
      if (!bot || !dashboardEvents.getStatus().running) {
        socket.emit('error', 'Bot is not running');
        return;
      }
      
      dashboardEvents.emitLog('info', '🛑 Stopping bot...');
      
      if (bot && typeof (bot as any).stop === 'function') {
        await (bot as any).stop();
      }
      
      bot = null;
      botStartPromise = null;
      dashboardEvents.setBotRunning(false);
      
      socket.emit('bot:stopped');
    } catch (error: any) {
      dashboardEvents.emitLog('error', `Failed to stop bot: ${error.message}`);
      socket.emit('error', error.message);
    }
  });
  
  socket.on('bot:reset-stats', () => {
    dashboardEvents.resetStats();
    socket.emit('stats:reset');
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                   🎛️  SOLANA ARBITRAGE BOT DASHBOARD                      ║
╚═══════════════════════════════════════════════════════════════════════════╝

🌐 Dashboard URL: http://localhost:${PORT}
📊 API Endpoint: http://localhost:${PORT}/api
🔌 WebSocket: Connected

Open your browser and visit the dashboard to:
  ✅ Monitor live prices and opportunities
  ✅ Start/Stop the bot
  ✅ View real-time logs
  ✅ Track attempts and profits
  ✅ Adjust settings (gas fees, flashloan amounts, etc.)

Press Ctrl+C to stop the server
  `);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down dashboard server...');
  
  if (bot && dashboardEvents.getStatus().running) {
    console.log('Stopping bot...');
    if (typeof (bot as any).stop === 'function') {
      await (bot as any).stop();
    }
  }
  
  io.close();
  httpServer.close(() => {
    console.log('Dashboard server stopped');
    process.exit(0);
  });
});
