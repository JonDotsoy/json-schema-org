require('ts-node/register');
const fs = require('fs');
const { default: parse } = require('./src/parse');

async function run() {

  fs.writeFileSync(
    'out.json',
    JSON.stringify(
      await parse('https://schema.org/Person'),
      null,
      2,
    ),
  );

}

run();