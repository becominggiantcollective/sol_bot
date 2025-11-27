#!/usr/bin/env node

/**
 * Pre-Deployment Checklist Script
 * 
 * Automates verification of critical pre-deployment requirements
 * Run this before every production deployment to ensure readiness
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

// Check result tracking
const results = {
  passed: [],
  failed: [],
  warnings: [],
  skipped: []
};

// Helper functions
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, colors.bright + colors.blue);
  console.log('='.repeat(60));
}

function logCheck(name, status, message = '') {
  const symbols = {
    pass: '✓',
    fail: '✗',
    warn: '⚠',
    skip: '○'
  };
  
  const statusColors = {
    pass: colors.green,
    fail: colors.red,
    warn: colors.yellow,
    skip: colors.blue
  };
  
  const symbol = symbols[status];
  const color = statusColors[status];
  
  log(`  ${symbol} ${name}`, color);
  if (message) {
    log(`    ${message}`, color);
  }
  
  // Track results
  results[status === 'pass' ? 'passed' : status === 'fail' ? 'failed' : status === 'warn' ? 'warnings' : 'skipped'].push(name);
}

function execCommand(command, silent = true) {
  try {
    return execSync(command, { 
      encoding: 'utf8',
      stdio: silent ? 'pipe' : 'inherit'
    });
  } catch (error) {
    return null;
  }
}

// Check functions
function checkNodeVersion() {
  logSection('1. Environment Checks');
  
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
  
  if (majorVersion >= 18) {
    logCheck('Node.js version', 'pass', `Using ${nodeVersion}`);
  } else {
    logCheck('Node.js version', 'fail', `${nodeVersion} is too old. Need v18 or higher.`);
  }
}

function checkDependencies() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  // Check if node_modules exists
  if (fs.existsSync('node_modules')) {
    logCheck('Dependencies installed', 'pass');
    
    // Run npm audit
    const auditOutput = execCommand('npm audit --json');
    if (auditOutput) {
      try {
        const audit = JSON.parse(auditOutput);
        const vulnerabilities = audit.metadata.vulnerabilities;
        
        if (vulnerabilities.high > 0 || vulnerabilities.critical > 0) {
          logCheck('Security audit', 'fail', 
            `Found ${vulnerabilities.critical || 0} critical and ${vulnerabilities.high || 0} high severity vulnerabilities. Run 'npm audit fix'.`);
        } else if (vulnerabilities.moderate > 0 || vulnerabilities.low > 0) {
          logCheck('Security audit', 'warn',
            `Found ${vulnerabilities.moderate || 0} moderate and ${vulnerabilities.low || 0} low severity vulnerabilities.`);
        } else {
          logCheck('Security audit', 'pass', 'No vulnerabilities found');
        }
      } catch (e) {
        logCheck('Security audit', 'skip', 'Could not parse audit results');
      }
    } else {
      logCheck('Security audit', 'skip', 'npm audit failed to run');
    }
  } else {
    logCheck('Dependencies installed', 'fail', 'node_modules not found. Run npm install.');
  }
}

function checkBuild() {
  logSection('2. Build Verification');
  
  // Check if TypeScript is installed
  const tscVersion = execCommand('npx tsc --version');
  if (tscVersion) {
    logCheck('TypeScript available', 'pass');
    
    // Check if dist exists and is recent
    if (fs.existsSync('dist')) {
      const distStats = fs.statSync('dist');
      const srcStats = fs.statSync('src');
      
      if (distStats.mtime > srcStats.mtime) {
        logCheck('Build up to date', 'pass');
      } else {
        logCheck('Build up to date', 'warn', 'Source files are newer than build. Run npm run build.');
      }
    } else {
      logCheck('Build exists', 'fail', 'dist directory not found. Run npm run build.');
    }
  } else {
    logCheck('TypeScript available', 'fail', 'TypeScript not found.');
  }
  
  // Try to compile
  log('\n  Attempting to compile TypeScript...');
  const compileResult = execCommand('npx tsc --noEmit');
  if (compileResult !== null) {
    logCheck('TypeScript compilation', 'pass');
  } else {
    logCheck('TypeScript compilation', 'fail', 'Compilation errors detected. Fix TypeScript errors.');
  }
}

function checkTests() {
  logSection('3. Test Suite');
  
  // Check if Jest is configured
  if (fs.existsSync('jest.config.js')) {
    logCheck('Jest configured', 'pass');
    
    log('\n  Running tests...');
    const testResult = execCommand('npm test 2>&1');
    if (testResult && testResult.includes('Test Suites:') && !testResult.includes('failed')) {
      logCheck('Test suite', 'pass', 'All tests passing');
    } else {
      logCheck('Test suite', 'fail', 'Some tests are failing. Fix before deployment.');
    }
  } else {
    logCheck('Jest configured', 'skip', 'No jest.config.js found');
  }
}

function checkConfiguration() {
  logSection('4. Configuration Checks');
  
  // Check for .env files
  const envFiles = ['.env', '.env.production', '.env.example'];
  
  envFiles.forEach(file => {
    if (fs.existsSync(file)) {
      logCheck(`${file} exists`, 'pass');
      
      // Parse and check critical variables
      const envContent = fs.readFileSync(file, 'utf8');
      const criticalVars = [
        'SOLANA_RPC_URL',
        'WALLET_PRIVATE_KEY',
        'MAX_SLIPPAGE',
        'MIN_PROFIT_THRESHOLD'
      ];
      
      criticalVars.forEach(varName => {
        if (envContent.includes(varName)) {
          const match = envContent.match(new RegExp(`${varName}=(.+)`));
          if (match && match[1] && match[1].trim() !== '') {
            // Don't log actual values for security
            if (file !== '.env.example') {
              logCheck(`  ${varName} configured`, 'pass');
            }
          }
        } else if (file !== '.env.example') {
          logCheck(`  ${varName} configured`, 'warn', `Missing in ${file}`);
        }
      });
      
      // Security checks
      if (file === '.env' || file === '.env.production') {
        if (envContent.includes('api.mainnet-beta.solana.com')) {
          logCheck('  RPC endpoint', 'warn', 
            'Using public RPC endpoint. Consider dedicated provider for production.');
        } else {
          logCheck('  RPC endpoint', 'pass', 'Using dedicated RPC provider');
        }
        
        // Check if example private key is being used
        if (envContent.includes('[1,2,3,4,5')) {
          logCheck('  Wallet security', 'fail', 
            'Using example private key! Replace with real wallet before deployment.');
        } else {
          logCheck('  Wallet security', 'pass');
        }
      }
    } else if (file !== '.env') {
      logCheck(`${file} exists`, file === '.env.example' ? 'pass' : 'warn');
    } else {
      logCheck(`${file} exists`, 'fail', 'Required .env file missing');
    }
  });
  
  // Check if .env is in .gitignore
  if (fs.existsSync('.gitignore')) {
    const gitignore = fs.readFileSync('.gitignore', 'utf8');
    if (gitignore.includes('.env')) {
      logCheck('.env in .gitignore', 'pass');
    } else {
      logCheck('.env in .gitignore', 'fail', 'Add .env files to .gitignore to prevent committing secrets');
    }
  }
}

function checkDocumentation() {
  logSection('5. Documentation');
  
  const requiredDocs = [
    'README.md',
    'PRE_GO_LIVE_ASSESSMENT.md',
    'PRODUCTION_DEPLOYMENT_GUIDE.md'
  ];
  
  requiredDocs.forEach(doc => {
    if (fs.existsSync(doc)) {
      logCheck(doc, 'pass');
    } else {
      logCheck(doc, 'warn', 'Documentation file missing');
    }
  });
}

function checkGitStatus() {
  logSection('6. Version Control');
  
  // Check if in git repo
  if (fs.existsSync('.git')) {
    logCheck('Git repository', 'pass');
    
    // Check for uncommitted changes
    const status = execCommand('git status --porcelain');
    if (status && status.trim() !== '') {
      logCheck('Uncommitted changes', 'warn', 
        'You have uncommitted changes. Consider committing before deployment.');
    } else {
      logCheck('Working directory clean', 'pass');
    }
    
    // Check current branch
    const branch = execCommand('git rev-parse --abbrev-ref HEAD');
    if (branch) {
      const branchName = branch.trim();
      if (branchName === 'main' || branchName === 'master') {
        logCheck('Git branch', 'pass', `On ${branchName} branch`);
      } else {
        logCheck('Git branch', 'warn', `On ${branchName} branch. Deploy from main/master?`);
      }
    }
  } else {
    logCheck('Git repository', 'skip', 'Not a git repository');
  }
}

function checkProduction() {
  logSection('7. Production Readiness');
  
  // Check if production build exists
  if (fs.existsSync('dist/index.js')) {
    logCheck('Production build', 'pass');
  } else {
    logCheck('Production build', 'fail', 'No production build found. Run npm run build.');
  }
  
  // Check for development dependencies in production mode
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (packageJson.devDependencies) {
    logCheck('Dev dependencies separated', 'pass');
  }
  
  // Check if assessment has been read
  if (fs.existsSync('PRE_GO_LIVE_ASSESSMENT.md')) {
    log('\n  ⚠️  Have you read and addressed items in PRE_GO_LIVE_ASSESSMENT.md?', colors.yellow);
    log('     This checklist cannot verify this - manual confirmation required.', colors.yellow);
  }
}

function checkSecurity() {
  logSection('8. Security Checks');
  
  // Check for common security issues
  const sensitivePatterns = [
    { pattern: /WALLET_PRIVATE_KEY=\[1,2,3,4,5/, file: '.env', message: 'Example private key detected' },
    { pattern: /password\s*=\s*["']password["']/, file: '.env', message: 'Weak password detected' },
    { pattern: /api[_-]?key\s*=\s*["']test["']/i, file: '.env', message: 'Test API key detected' }
  ];
  
  if (fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    let securityIssues = 0;
    
    sensitivePatterns.forEach(({ pattern, message }) => {
      if (pattern.test(envContent)) {
        logCheck('Security scan', 'fail', message);
        securityIssues++;
      }
    });
    
    if (securityIssues === 0) {
      logCheck('Security scan', 'pass', 'No obvious security issues in .env');
    }
  }
  
  // Check file permissions (Unix-like systems)
  if (process.platform !== 'win32' && fs.existsSync('.env')) {
    try {
      const stats = fs.statSync('.env');
      const mode = (stats.mode & parseInt('777', 8)).toString(8);
      if (mode === '600' || mode === '400') {
        logCheck('Environment file permissions', 'pass', `Permissions: ${mode}`);
      } else {
        logCheck('Environment file permissions', 'warn', 
          `Permissions are ${mode}. Recommended: 600 (chmod 600 .env)`);
      }
    } catch (e) {
      logCheck('Environment file permissions', 'skip', 'Could not check permissions');
    }
  }
}

function printSummary() {
  logSection('Summary');
  
  console.log();
  log(`✓ Passed:   ${results.passed.length}`, colors.green);
  log(`✗ Failed:   ${results.failed.length}`, colors.red);
  log(`⚠ Warnings: ${results.warnings.length}`, colors.yellow);
  log(`○ Skipped:  ${results.skipped.length}`, colors.blue);
  console.log();
  
  if (results.failed.length > 0) {
    log('DEPLOYMENT BLOCKED - Fix failed checks before deploying', colors.red + colors.bright);
    console.log();
    log('Failed checks:', colors.red);
    results.failed.forEach(check => log(`  • ${check}`, colors.red));
    console.log();
    process.exit(1);
  } else if (results.warnings.length > 0) {
    log('DEPLOYMENT ALLOWED WITH WARNINGS', colors.yellow + colors.bright);
    console.log();
    log('Warnings:', colors.yellow);
    results.warnings.forEach(check => log(`  • ${check}`, colors.yellow));
    console.log();
    log('Review warnings and proceed with caution.', colors.yellow);
    console.log();
    process.exit(0);
  } else {
    log('ALL CHECKS PASSED - READY FOR DEPLOYMENT! ✓', colors.green + colors.bright);
    console.log();
    log('Next steps:', colors.blue);
    log('  1. Review PRE_GO_LIVE_ASSESSMENT.md', colors.blue);
    log('  2. Follow PRODUCTION_DEPLOYMENT_GUIDE.md', colors.blue);
    log('  3. Start with minimal capital ($100-500)', colors.blue);
    log('  4. Monitor intensively for first 48 hours', colors.blue);
    console.log();
    process.exit(0);
  }
}

// Main execution
function main() {
  log('\n╔════════════════════════════════════════════════════════╗', colors.bright);
  log('║    Solana Arbitrage Bot - Pre-Deployment Checker     ║', colors.bright);
  log('╚════════════════════════════════════════════════════════╝', colors.bright);
  
  try {
    checkNodeVersion();
    checkDependencies();
    checkBuild();
    checkTests();
    checkConfiguration();
    checkDocumentation();
    checkGitStatus();
    checkProduction();
    checkSecurity();
    
    printSummary();
  } catch (error) {
    console.error('\n❌ Pre-deployment check failed with error:');
    console.error(error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { main };
