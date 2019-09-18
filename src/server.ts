import express from 'express';
import chalk from 'chalk';
import { ParseSchemaOrgCache } from './parse';
import url from 'url';

// configs
const PORT = process.env.PORT || 9000;
const BASE_URL = process.env.BASE_URL || 'http://localhost:9000';

const app = express();

app.set('case sensitive routing', true);

app.use('/favicon.ico', (res, req, next) => req.end());

app.use((req, res, next) => {
  const t1 = Date.now()
  req.once('end', () => {
    const t2 = Date.now() - t1;
    console.log(chalk`[{green ${req.method}}] ${req.path} {green ${t2.toString()}ms}`);
  });
  return next();
});

app.get('/:schameName', (req, res, next) => ParseSchemaOrgCache(`https://schema.org/${req.params.schameName}`, {
  modeJsonSchema: true,
  useCache: !true,
  transformUrls: (uri) => {
    const { hostname, pathname } = url.parse(uri, true);

    return pathname && hostname === 'schema.org' ? url.resolve(BASE_URL, pathname) : uri;
  },
})
  .then(r => res.json(r))
  .catch(next));

app.listen(PORT, () => console.log(chalk`{grey #} Server ready {green http://localhost:${PORT.toString()}}`));