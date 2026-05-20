// Static fixture fallback table.
// Maps an API request path (query string stripped, dynamic id segments
// normalized) to a canned response so the UI keeps working when a backend
// endpoint is missing/unreachable. When the real endpoint ships, the client
// passes live data through untouched — no code change needed here.

import summary from './summary.json'
import files from './files.json'
import file from './file.json'
import fileContent from './file-content.json'
import emails from './emails.json'
import email from './email.json'
import entities from './entities.json'
import graphNodes from './graph-nodes.json'
import graphEdgesEmail from './graph-edges-email.json'
import graphEdgesActivity from './graph-edges-activity.json'
import timeline from './timeline.json'
import cases from './cases.json'
import caseDetail from './case.json'
import sessions from './sessions.json'
import session from './session.json'
import findings from './findings.json'
import submit from './submit.json'

const EXACT: Record<string, unknown> = {
  '/summary': summary,
  '/search/files': files,
  '/search/emails': emails,
  '/entities': entities,
  '/graph/nodes': graphNodes,
  '/graph/edges/email': graphEdgesEmail,
  '/graph/edges/activity': graphEdgesActivity,
  '/timeline': timeline,
  '/cases': cases,
  '/sessions': sessions,
  '/investigations': submit,
}

const DYNAMIC: { pattern: RegExp; fixture: unknown }[] = [
  { pattern: /^\/files\/[^/]+\/content$/, fixture: fileContent },
  { pattern: /^\/files\/[^/]+$/, fixture: file },
  { pattern: /^\/emails\/[^/]+$/, fixture: email },
  { pattern: /^\/cases\/[^/]+$/, fixture: caseDetail },
  { pattern: /^\/sessions\/[^/]+\/findings$/, fixture: findings },
  { pattern: /^\/sessions\/[^/]+$/, fixture: session },
]

export function resolveFixture(rawPath: string): unknown | undefined {
  const path = rawPath.split('?')[0]
  if (path in EXACT) return EXACT[path]
  for (const { pattern, fixture } of DYNAMIC) {
    if (pattern.test(path)) return fixture
  }
  return undefined
}
