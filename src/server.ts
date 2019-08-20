import express from 'express';
import { ParseSchemaOrgCache } from './parse';

const app = express();

app.set('case sensitive routing', true);

app.get('/:schameName', (req, res, next) => ParseSchemaOrgCache(`https://schema.org/${req.params.schameName}`)
  .then(r => res.json(r))
  .catch(next)
);

app.listen(9000);