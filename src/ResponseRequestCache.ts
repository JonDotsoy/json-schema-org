import request, { CoreOptions, Response } from 'request';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { existsSync, readFileSync, writeFileSync } from 'fs';

type ResponseRequestCache = Pick<request.Response,
  | 'statusCode'
  | 'headers'
  | 'body'
  | 'request'
>;

export const requestCache = async (schemaUri: string, options: CoreOptions) => {
  const pathCache = `${tmpdir()}/req_${Buffer.from(schemaUri).toString('hex')}.json`;

  if (existsSync(pathCache)) {
    return JSON.parse(readFileSync(pathCache, 'utf8')) as ResponseRequestCache;
  }

  const res = await promisify<string, CoreOptions, Response>(request)(schemaUri, options);

  writeFileSync(
    pathCache,
    JSON.stringify(
      <ResponseRequestCache>{
        headers: res.headers,
        body: res.body,
        request: res.request,
        statusCode: res.statusCode,
      },
    ),
    'utf8',
  );

  return res;
};
