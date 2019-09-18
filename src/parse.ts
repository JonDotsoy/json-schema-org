
import xpath from 'xpath';
import { DOMParser } from 'xmldom';
import { tmpdir } from 'os';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { requestCache } from './ResponseRequestCache';
import { promisify } from 'util';
import url from 'url';

const SNode = Symbol('node');
const SParentOption = Symbol('parentOption');
const SSetted = Symbol('setted');
const SAttributes = Symbol('attributes');

type IspTypes = 'rdfs:Class' |
  'owl:equivalentClass' |
  'rdfs:label' |
  'rdfs:subClassOf' |
  'rdfs:comment' |
  'sameAs' |
  'rdfs:Property' |
  'rangeIncludes' |
  'domainIncludes';

type ParentOptionC = {
  levelContain: number;
  parentId: number;
  schemaDefinition: SchemaDefinition;
}
type ParentOption = {
  parents: ParentOptionC[];
  principalParent?: ParentOptionC;
}

interface OptionsParseSchema {
  useCache?: boolean;
  transformUrls?(uri: string): string;
  modeJsonSchema?: boolean;
}

const nameNodeMapToObjectAttributes = (namedNodeMap: NamedNodeMap) => {
  return Array(namedNodeMap.length).fill('')
    .map((_, i) => namedNodeMap.item(i) as Attr)
    .reduce((v, { name, value }) => (v[name] = value, v), {} as { [attr: string]: string });
}

export const ParseSchemaOrgCache = async (schemaUri: string, opts?: OptionsParseSchema) => {
  const pathCache = `${tmpdir()}/schema_${Buffer.from(schemaUri).toString('hex')}.json`;
  // console.log(pathCache);

  if (opts && opts.useCache && existsSync(pathCache)) {
    return JSON.parse(readFileSync(pathCache, 'utf8'));
  }

  const isp = (await parseSchemaOrg(schemaUri, opts)) || {};

  if (opts && opts.useCache) {
    writeFileSync(pathCache, JSON.stringify(isp), 'utf8');
  }

  return isp;
}

export default async function parseSchemaOrg(schemaUri: string, opts?: OptionsParseSchema) {
  const res = await requestCache(schemaUri, { method: 'GET' });

  if (res.statusCode === 404) {
    throw new Error(`Cannot found ${schemaUri}.`)
  }

  const doc = new DOMParser({
    errorHandler: {
      error: () => { },
      fatalError: () => { },
      warning: () => { },
    }//*[@id="mainContent"]/div[1]
  }).parseFromString(res.body);

  return recoverSchemaDefinition(doc, opts);
}

type SchemaDefinition = {
  id: number,
  type: IspTypes;
  label?: string;
  comment?: string;
  href: string;
  resource: string;
  childs: SchemaDefinition[];
  [SParentOption]: ParentOption;
  [SSetted]: boolean;
  [SNode]: Element;
  [SAttributes]: ReturnType<typeof nameNodeMapToObjectAttributes>;
  toJSON(): any;
}

const recoverSchemaDefinition = (node: Document, opts?: OptionsParseSchema) => {
  const elements = xpath.select('//*[@resource]|//*[@property]|//*[@typeof]', node) as Element[];

  const schemaDefinitions = elements.map(e => prepareSchemaDefinition(e, opts)).map((e, i) => (e.id = i + 1, e));

  schemaDefinitions.forEach((schemaDefinitionA, _, els) => {
    const parentOption = schemaDefinitionA[SParentOption];

    els.forEach((schemaDefinition, _) => {
      const elementSchemaDefA = schemaDefinitionA[SNode];
      const elementSchemaDefB = schemaDefinition[SNode];

      let levelContain = elementContains(elementSchemaDefA, elementSchemaDefB);

      if (levelContain) {
        const parentId = schemaDefinition.id;

        const parentSetter: ParentOptionC = { levelContain, parentId, schemaDefinition };

        parentOption.parents.push(parentSetter);

        if (
          !parentOption.principalParent ||
          parentOption.principalParent.levelContain > levelContain
        ) {
          parentOption.principalParent = parentSetter;
        }
      }
    });
  });

  schemaDefinitions.forEach((el, _, els) => el.childs = els.filter(({ [SParentOption]: parentOption }) =>
    parentOption.principalParent &&
    parentOption.principalParent.parentId === el.id
  ));

  const classDef = schemaDefinitions.find(e => e.type === 'rdfs:Class');

  if (opts && opts.modeJsonSchema) {
    if (classDef) {
      const ob = classDef.toJSON();

      const transformPrimmitiveTypes = (e: any) => {
        const djson = e.toJSON();

        if (typeof djson !== 'string') return e;

        const { pathname } = url.parse(djson);

        switch (pathname) {
          case '/URL':
            return {
              "title": "URL",
              "description": "Matches the elements of a URL using a regular expression.",
              "type": "string",
              "pattern": "^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\\/\\/((?:(?=((?:[a-zA-Z0-9-._~!$&'()*+,;=:]|%[0-9a-fA-F]{2})*))(\\3)@)?(?=((?:\\[?(?:::[a-fA-F0-9]+(?::[a-fA-F0-9]+)?|(?:[a-fA-F0-9]+:)+(?::[a-fA-F0-9]+)+|(?:[a-fA-F0-9]+:)+(?::|(?:[a-fA-F0-9]+:?)*))\\]?)|(?:[a-zA-Z0-9-._~!$&'()*+,;=]|%[0-9a-fA-F]{2})*))\\5(?::(?=(\\d*))\\6)?)(\\/(?=((?:[a-zA-Z0-9-._~!$&'()*+,;=:@\\/]|%[0-9a-fA-F]{2})*))\\8)?|(\\/?(?!\\/)(?=((?:[a-zA-Z0-9-._~!$&'()*+,;=:@\\/]|%[0-9a-fA-F]{2})*))\\10)?)(?:\\?(?=((?:[a-zA-Z0-9-._~!$&'()*+,;=:@\\/?]|%[0-9a-fA-F]{2})*))\\11)?(?:#(?=((?:[a-zA-Z0-9-._~!$&'()*+,;=:@\\/?]|%[0-9a-fA-F]{2})*))\\12)?$"
            }
          case '/Date':
          case '/GenderType':
          case '/Text':
            return {
              type: 'string',
            }
          case '/Number':
            return {
              type: 'number',
            }
          case '/Boolean':
            return {
              type: 'boolean',
            }
        }
      }

      return {
        $id: ob.resource,
        $schema: 'http://json-schema.org/draft-07/schema',
        description: ob.comment,
        properties: ob.properties.reduce((ac: any, _property: any) => {
          const property = _property.toJSON() as any;

          const oneof = property.rangeIncludes.map((e: any) => {
            const r = transformPrimmitiveTypes(e);
            return r ? r : {
              $ref: e,
            };
          });

          const u = new Map<string, any>();

          oneof.forEach((e: any) => u.set(e.type || e.$ref, e));

          const prop = {} as any;

          prop.description = property.comment;

          prop.anyOf = [
            ...Array.from(u.values()),
            {
              type: "array",
              items: {
                anyOf: Array.from(u.values())
              }
            }
          ];

          ac[property.label.toJSON()] = prop;

          return ac;
        }, {}),
      };
    }
  } else {
    return classDef;
  }
}

const elementContains = (elementFind: Element, b: Element) => {
  let currentElementFind = elementFind;
  let levelContain = 0;

  while (true) {
    levelContain++;
    if (!currentElementFind.parentNode) return false;
    if (currentElementFind.parentNode === b) return levelContain;
    currentElementFind = currentElementFind.parentNode as Element;
  }
}

const prepareSchemaDefinition = (node: Element, opts?: OptionsParseSchema): SchemaDefinition => {
  const attributes = nameNodeMapToObjectAttributes(node.attributes);
  const type = attributes.typeof as IspTypes || attributes.property as IspTypes;
  let label;
  let comment;
  let href;
  let resource;

  if (type === 'rdfs:label') {
    label = node.textContent as string;
  }

  if (type === 'rdfs:comment') {
    comment = node.textContent as string;
  }

  href = attributes.href;
  resource = attributes.resource;

  return {
    id: 0,
    type,
    label,
    comment,
    href,
    resource,
    [SParentOption]: {
      parents: [],
    },
    childs: [] as any[],
    [SSetted]: false,
    [SNode]: node,
    [SAttributes]: attributes,
    toJSON() {
      const { type, resource, childs, label, comment, href } = this;

      switch (type) {
        case 'rdfs:Class': {
          const properties = childs.filter(c => c.type === 'rdfs:Property');

          return {
            label: childs.find(c => c.type === "rdfs:label"),
            comment: childs.find(c => c.type === 'rdfs:comment'),
            resource: opts && opts.transformUrls ? opts.transformUrls(resource) : resource,
            sameAs: childs.find(c => c.type === 'sameAs'),
            equivalentClass: childs.find(c => c.type === 'owl:equivalentClass'),
            subClassOf: childs.find(c => c.type === "rdfs:subClassOf"),
            properties: properties,
          };
        }
        case 'rdfs:label': return label;
        case 'rdfs:comment': return comment;
        case 'owl:equivalentClass':
        case 'rdfs:subClassOf':
        case 'domainIncludes':
        case 'rangeIncludes':
        case 'sameAs': return opts && opts.transformUrls ? opts.transformUrls(href) : href;
        case 'rdfs:Property': {
          const rangeIncludes = childs.filter(c => c.type === 'rangeIncludes');
          const domainIncludes = childs.filter(c => c.type === 'domainIncludes');
          return {
            label: childs.find(c => c.type === 'rdfs:label'),
            comment: childs.find(c => c.type === 'rdfs:comment'),
            rangeIncludes,
            domainIncludes,
          }
        };
      }
    }
  };
}
