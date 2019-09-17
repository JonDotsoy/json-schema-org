import express from 'express';
import chalk from 'chalk';
import { ParseSchemaOrgCache } from './parse';
import url from 'url';

const app = express();

app.set('case sensitive routing', true);

app.use('/favicon.ico', (res, req, next) => req.end());

app.use((req, res, next) => {
  const t1 = Date.now()
  req.once('end', () => {
    const t2 = Date.now() - t1;
    console.log(chalk`{green ${t2.toString()}ms} [{green ${req.method}}] ${req.path}`);
  });
  return next();
});

app.get('/:schameName', (req, res, next) => ParseSchemaOrgCache(`https://schema.org/${req.params.schameName}`, {
  modeJsonSchema: true,
  transformUrls: (uri) => {
    const { hostname, pathname } = url.parse(uri, true);

    return pathname && hostname === 'schema.org' ? url.resolve(`http://localhost:9000`, pathname) : uri;
  },
})
  .then(r => res.json(r))
  .catch(next));

app.listen(9000, () => console.log(chalk`server ready {green http://localhost:9000}`));