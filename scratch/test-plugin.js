const fs = require('fs');
const xml2js = require('xml2js');
const withAndroidNotificationListener = require('../plugins/withAndroidNotificationListener');

async function test() {
  const xmlPath = './android/app/src/main/AndroidManifest.xml';
  if (!fs.existsSync(xmlPath)) {
    console.log('Manifest does not exist');
    return;
  }
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const parser = new xml2js.Parser();
  const builder = new xml2js.Builder();
  
  const result = await parser.parseStringPromise(xml);
  const config = { modResults: result };
  
  // Call our plugin function directly
  // In Expo, config plugins are called with (config, props). 
  // withAndroidManifest wraps this, but let's see how our inner mod function behaves
  const modResults = config.modResults;
  let mainApplication = modResults.manifest.application[0];
  
  console.log('Before:', mainApplication.$);
  
  if (!mainApplication.$) {
    mainApplication.$ = {};
  }
  mainApplication.$['tools:replace'] = mainApplication.$['tools:replace']
    ? `${mainApplication.$['tools:replace']},android:allowBackup`
    : 'android:allowBackup';
    
  console.log('After:', mainApplication.$);
  
  const newXml = builder.buildObject(modResults);
  console.log('Includes tools:replace?', newXml.includes('tools:replace'));
}

test().catch(console.error);
