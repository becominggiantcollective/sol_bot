/// Tracks bot performance metrics
#[derive(Debug, Clone)]
pub struct BotMetrics {
    pub scans_total: u64,
    pub opportunities_found: u64,
    pub successful_trades: u64,
    pub failed_trades: u64,
    pub total_profit: f64,
    pub scan_errors: u64,
}

impl BotMetrics {
    pub fn new() -> Self {
        Self {
            scans_total: 0,
            opportunities_found: 0,
            successful_trades: 0,
            failed_trades: 0,
            total_profit: 0.0,
            scan_errors: 0,
        }
    }

    pub fn win_rate(&self) -> f64 {
        if self.successful_trades + self.failed_trades == 0 {
            0.0
        } else {
            self.successful_trades as f64 / (self.successful_trades + self.failed_trades) as f64
        }
    }

    pub fn profit_per_trade(&self) -> f64 {
        if self.successful_trades == 0 {
            0.0
        } else {
            self.total_profit / self.successful_trades as f64
        }
    }
}

impl Default for BotMetrics {
    fn default() -> Self {
        Self::new()
    }
}
