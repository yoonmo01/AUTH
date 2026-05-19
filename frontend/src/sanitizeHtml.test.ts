// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from './sanitizeHtml'

describe('sanitizeHtml — security', () => {
  it('drops <script> and its source entirely', () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>')
    expect(out).toContain('ok')
    expect(out).not.toContain('alert')
    expect(out.toLowerCase()).not.toContain('<script')
  })

  it('drops a nested <script> but keeps sibling text', () => {
    const out = sanitizeHtml('<p>before<script>steal()</script>after</p>')
    expect(out).toContain('before')
    expect(out).toContain('after')
    expect(out).not.toContain('steal')
  })

  it('removes event-handler attributes', () => {
    const out = sanitizeHtml('<p onclick="evil()">hi</p>')
    expect(out).toContain('hi')
    expect(out.toLowerCase()).not.toContain('onclick')
    expect(out).not.toContain('evil')
  })

  it('strips disallowed tags but keeps their text (unwrap)', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">link</a>')
    expect(out).toContain('link')
    expect(out.toLowerCase()).not.toContain('<a')
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out.toLowerCase()).not.toContain('href')
  })

  it('removes <img> with onerror payload entirely', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)">caption')
    expect(out.toLowerCase()).not.toContain('<img')
    expect(out.toLowerCase()).not.toContain('onerror')
    expect(out).toContain('caption')
  })

  it('drops <style> blocks (CSS injection surface)', () => {
    const out = sanitizeHtml('<style>body{display:none}</style><p>visible</p>')
    expect(out).toContain('visible')
    expect(out.toLowerCase()).not.toContain('<style')
    expect(out).not.toContain('display:none')
  })

  it('keeps <mark> only with a whitelisted data-label', () => {
    const ok = sanitizeHtml('<mark data-label="suspicious">x</mark>')
    expect(ok).toContain('data-label="suspicious"')

    const bad = sanitizeHtml('<mark data-label="javascript:evil">y</mark>')
    expect(bad).toContain('y')
    expect(bad).toContain('<mark')
    expect(bad).not.toContain('data-label')
  })

  it('keeps allowed structural tags and class attribute', () => {
    const out = sanitizeHtml('<p class="lead">a<strong>b</strong><em>c</em></p>')
    expect(out).toContain('<p class="lead">')
    expect(out).toContain('<strong>b</strong>')
    expect(out).toContain('<em>c</em>')
  })

  it('escapes raw text so injected markup cannot execute', () => {
    const out = sanitizeHtml('<p>1 &lt; 2 &amp; 3</p><div>&lt;script&gt;</div>')
    expect(out).not.toMatch(/<script/i)
    expect(out).toContain('1 &lt; 2 &amp; 3')
  })
})
