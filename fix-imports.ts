import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

function fixImportsInFile(filePath: string) {
  try {
    let content = readFileSync(filePath, 'utf8');
    let modified = false;

    // Fix relative imports (add .js extension)
    const relativeImportRegex = /from\s+['"](\.[^'"]*?)['"];?/g;
    content = content.replace(relativeImportRegex, (match, importPath) => {
      if (!importPath.endsWith('.js') && !importPath.endsWith('.json')) {
        modified = true;
        return match.replace(importPath, importPath + '.js');
      }
      return match;
    });

    if (modified) {
      writeFileSync(filePath, content, 'utf8');
      console.log(`Fixed imports in: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }
}

function processDirectory(dirPath: string) {
  const items = readdirSync(dirPath);
  
  for (const item of items) {
    const fullPath = join(dirPath, item);
    const stats = statSync(fullPath);
    
    if (stats.isDirectory() && item !== 'node_modules' && item !== 'dist') {
      processDirectory(fullPath);
    } else if (stats.isFile() && extname(item) === '.ts') {
      fixImportsInFile(fullPath);
    }
  }
}

console.log('Fixing ES module imports...');
processDirectory('./src');
console.log('Done!');