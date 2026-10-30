/** Résumé-side skill knowledge. The shared vocabulary stays literal; nothing here changes collected counts. */
import { detectSkills } from './matcher.mjs';

export const CATEGORIES = [
  {id:'languages',label:'Languages',skills:['python','javascript','typescript','java','csharp','cpp','go','rust','ruby','scala','kotlin','swift','php','perl','html','css','bash','shell-scripting']},
  {id:'frameworks',label:'Frameworks & APIs',skills:['react','nodejs','graphql','rest-api','spring','django','flask','angular','vue','nextjs','dotnet']},
  {id:'cloud',label:'Cloud & DevOps',skills:['aws','azure','gcp','docker','kubernetes','terraform','git','linux','ci-cd','gitlab','github','jenkins','ansible','observability','cybersecurity','networking']},
  {id:'data',label:'Data',skills:['sql','postgresql','mysql','redis','mongodb','elasticsearch','snowflake','databricks','spark','kafka','airflow','data-engineering','data-analysis','tableau','power-bi','data-visualization','statistics','experimentation','excel']},
  {id:'ai',label:'AI & ML',skills:['machine-learning','pandas','numpy','pytorch','tensorflow','scikit-learn','deep-learning','natural-language-processing','generative-ai','llm','computer-vision']},
  {id:'product',label:'Product & design',skills:['figma','product-management','user-research','user-experience','accessibility','prototyping','technical-writing']},
  {id:'delivery',label:'Project delivery',skills:['agile','scrum','jira','confluence','project-management','project-planning','stakeholder-management','powerpoint','word']},
  {id:'business',label:'Business',skills:['salesforce','financial-analysis','accounting','forecasting','budgeting','sales','crm','marketing','seo','recruiting','supply-chain','sap','netsuite']},
  {id:'general',label:'General',skills:['communication','leadership','negotiation','operations','customer-service']}
];
const categoryOf = new Map(CATEGORIES.flatMap(c => c.skills.map(id => [id, c.id])));
export const skillCategory = id => categoryOf.get(id) || 'general';

/** Traits most postings ask for and few résumés spell out, so they would distort a match score. */
export const GENERAL_SKILLS = CATEGORIES.at(-1).skills;

// Plain résumé shorthand for skills the vocabulary only recognizes in their long form. Case-sensitive.
const SHORTHAND = {
  'rest-api':[/\bREST(?:ful)?\b/],
  'natural-language-processing':[/\bNLP\b/],
  'machine-learning':[/\bML\b/,/\bMLOps\b/],
  'data-engineering':[/\bETL\b/,/\bELT\b/,/\bdata pipelines?\b/i,/\bdata warehous/i],
  'generative-ai':[/\bGen ?AI\b/i,/\bRAG\b/,/\bLangChain\b/i,/\bLangGraph\b/i],
  llm:[/\bLangChain\b/i,/\bRAG\b/,/\bGPT-?\d?\b/],
  nodejs:[/\bNode\b/,/\bExpress\.?js\b/i,/\bNestJS\b/i],
  go:[/(?:^|[,|/•:(]\s*)Go(?=\s*(?:[,|/•)]|$))/m],
  vue:[/\bVue\b/],
  spark:[/\bSpark\b(?!\s+(?:AR|Hire))/],
  'ci-cd':[/\bCI\s?\/\s?CD\b/,/\bCICD\b/,/\bGitHub Actions\b/i,/\bCircleCI\b/i],
  kubernetes:[/\b[EGA]KS\b/],
  aws:[/\bEC2\b/,/\bDynamoDB\b/,/\bLambda\b/],
  gcp:[/\bBigQuery\b/i,/\bVertex AI\b/i],
  sql:[/\bT-SQL\b/,/\bPL\/SQL\b/],
  dotnet:[/\bASP\.NET\b/i,/\bEntity Framework\b/i],
  'data-visualization':[/\bD3(?:\.js)?\b/]
};
// Skills that are safe to assume from a more specific one.
const IMPLIES = {
  postgresql:['sql'],mysql:['sql'],typescript:['javascript'],nextjs:['react'],
  pytorch:['machine-learning','deep-learning'],tensorflow:['machine-learning','deep-learning'],
  'scikit-learn':['machine-learning'],'deep-learning':['machine-learning'],
  'natural-language-processing':['machine-learning'],'computer-vision':['machine-learning'],
  llm:['generative-ai']
};
// Everyday words that are only skills when written like a product name.
const NEEDS_CASE = {excel:/\bExcel\b(?!\s+(?:at|in)\b)/,rust:/\bRust\b/,swift:/\bSwift\b/,ruby:/\bRuby\b/,flask:/\bFlask\b/,angular:/\bAngular(?:JS)?\b/,sap:/\bSAP\b/};

export function detectResumeSkills(text, vocabulary) {
  const known = new Set(vocabulary.skills.map(s => s.id));
  const found = new Set(detectSkills(text, vocabulary));
  for (const [id, pattern] of Object.entries(NEEDS_CASE)) if (found.has(id) && !pattern.test(text)) found.delete(id);
  for (const [id, patterns] of Object.entries(SHORTHAND)) if (known.has(id) && patterns.some(p => p.test(text))) found.add(id);
  for (const id of [...found]) for (const implied of IMPLIES[id] || []) if (known.has(implied)) found.add(implied);
  return found;
}

// Data and delivery skills cross fields, so they are open to everyone and claim no field of their own.
const FIELDS = {languages:'tech',frameworks:'tech',cloud:'tech',ai:'tech',product:'business',business:'business'};

/** Keep suggestions inside fields the résumé already touches: a developer is not told to learn recruiting. */
export function suggestible(recommendations, selected) {
  const fields = new Set([...selected].map(id => FIELDS[skillCategory(id)]));
  return recommendations.filter(r => {
    const category = skillCategory(r.id);
    return category !== 'general' && (!FIELDS[category] || fields.has(FIELDS[category]));
  });
}
