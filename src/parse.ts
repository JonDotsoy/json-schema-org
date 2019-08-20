
import request, { CoreOptions, Response } from 'request';
import { promisify } from 'util';
import xpath from 'xpath';
import { DOMParser } from 'xmldom';
import { tmpdir } from 'os';
import { existsSync, readFileSync, writeFileSync } from 'fs';

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

const nameNodeMapToObjectAttributes = (namedNodeMap: NamedNodeMap) => {
  return Array(namedNodeMap.length).fill('')
    .map((_, i) => namedNodeMap.item(i) as Attr)
    .reduce((v, { name, value }) => (v[name] = value, v), {} as { [attr: string]: string });
}

export const ParseSchemaOrgCache = async (schemaUri: string) => {
  const pathCache = `${tmpdir()}/schema_${Buffer.from(schemaUri).toString('hex')}.json`;
  // console.log(pathCache);

  if (existsSync(pathCache)) {
    return JSON.parse(readFileSync(pathCache, 'utf8'));
  }

  const isp = (await parseSchemaOrg(schemaUri)) || {};

  writeFileSync(pathCache, JSON.stringify(isp), 'utf8');

  return isp;
}

const requestCache = async (schemaUri: string, options: CoreOptions) => {
  const pathCache = `${tmpdir()}/req_${Buffer.from(schemaUri).toString('hex')}.json`;

  if (existsSync(pathCache)) {
    return JSON.parse(readFileSync(pathCache, 'utf8'));
  }

  const res = await promisify<string, CoreOptions, Response>(request)(
    schemaUri,
    options,
  );

  writeFileSync(pathCache, JSON.stringify({
    headers: res.headers,
    body: res.body,
    request: res.request,
  }), 'utf8');

  return res;
}

export default async function parseSchemaOrg(schemaUri: string) {
  const res = await requestCache(schemaUri, { method: 'GET' });

  const doc = new DOMParser({
    errorHandler: {
      error: () => { },
      fatalError: () => { },
      warning: () => { },
    }//*[@id="mainContent"]/div[1]
  }).parseFromString(res.body);

  return recoverSchemaDefinition(doc);
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

const recoverSchemaDefinition = (node: Document) => {
  const elements = xpath.select('//*[@resource]|//*[@property]|//*[@typeof]', node) as Element[];

  const schemaDefinitions = elements.map(prepareSchemaDefinition).map((e, i) => (e.id = i + 1, e));

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

  return schemaDefinitions.find(e => e.type === 'rdfs:Class');
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

const prepareSchemaDefinition = (node: Element): SchemaDefinition => {
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
            resource,
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
        case 'sameAs': return href;
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
