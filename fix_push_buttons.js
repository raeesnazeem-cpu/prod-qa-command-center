const fs = require('fs');
const path = require('path');

const componentsDir = path.join(__dirname, 'apps/web/src/components');

// The new block to replace the ternary with
const newBlock = `{isPushing ? (
                <span className="text-[11px] font-bold px-1">...</span>
              ) : isPushed ? (
                <>
                  <span className="text-slate">Success </span>
                  <svg width="18" height="18" viewBox="0 0 35 30" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="pl-1"><path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path></svg>
                </>
              ) : (
                <>
                  <span className="text-white">Push to </span>
                  <svg width="18" height="18" viewBox="0 0 35 30" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="pl-1"><path d="M18.088.27c9.1 0 15.215 10.518 15.977 21.937.02.313-.053.626-.212.896-3.14 5.35-10.061 6.527-15.737 6.558-5.487.1-10.7-2.188-14.412-6.301a1.566 1.566 0 0 1-.303-1.6 36.177 36.177 0 0 1 1.912-4.147c1.052-1.928 2.644-4.681 5.154-4.763 2.343 0 3.516 2.174 5.114 3.519 1.633-1.672 2.552-3.94 3.567-6.014a1.565 1.565 0 0 1 2.837 1.326c-.885 1.829-1.814 3.651-2.954 5.336-1.172 1.732-2.073 2.636-3.33 2.636-.746 0-1.385-.292-2.03-.801-1.103-.92-1.937-2.088-3.15-2.873-1.567.785-2.99 4.079-3.824 5.98 2.925 2.88 6.898 4.55 11.008 4.573 4.622-.028 10.286-.49 13.197-4.62-.575-7.111-4.013-18.377-12.814-18.51-7.097 0-11.754 5.047-14.775 13.644A1.565 1.565 0 1 1 .36 16.008C3.771 6.299 9.333.27 18.088.27Z"></path></svg>
                </>
              )}`;

const targetFiles = [
  'SocialShareHeadingFindingCard.tsx',
  'LogoOnChatbotFindingCard.tsx',
  'CallnowFindingCard.tsx',
  'FaviconFindingCard.tsx',
  'SingleScriptFindingCard.tsx',
  'HeaderFindingCard.tsx',
  'DeadLinksFindingCard.tsx'
];

targetFiles.forEach(file => {
  const filePath = path.join(componentsDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace the single line ternary if it exists
    const regex1 = /\{isPushing \? "\.\.\." : isPushed \? "Success" : "Push"\}/g;
    if (regex1.test(content)) {
      content = content.replace(regex1, newBlock);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Fixed', file);
    }
    
    // Replace multi-line ternary if it exists
    const regex2 = /\{isPushing \?\s*\(\s*<span[^>]*>\.\.\.<\/span>\s*\)\s*:\s*isPushed\s*\?\s*\(\s*(?:<>\s*<span[^>]*>Success <\/span>[\s\S]*?<\/svg>\s*<\/>|"Success")\s*\)\s*:\s*\(\s*(?:<>\s*<span[^>]*>Push to <\/span>[\s\S]*?<\/svg>\s*<\/>|"Push"|<span[^>]*>Push<\/span>)\s*\)\}/g;
    if (regex2.test(content)) {
      content = content.replace(regex2, newBlock);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Fixed multi-line', file);
    }
  }
});
