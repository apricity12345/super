import test from "node:test";
import assert from "node:assert/strict";

import { profile } from "../content.js";
import {
  escapeHtml,
  externalLinkAttributes,
  isExternalUrl,
  renderPage,
  renderProjectCard,
  resolveTheme,
  toggleTheme,
} from "../render.js";

const YEAR = 2026;

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

test("renderPage 输出首屏、四个分区与页脚", () => {
  const html = renderPage(profile, { year: YEAR });

  assert.match(html, /<h1 class="hero-name">张旭锋<\/h1>/);
  assert.ok(html.includes(profile.tagline));
  assert.match(html, /id="main-content"/);
  assert.equal(countOccurrences(html, 'class="project-card"'), 3);
  assert.equal(countOccurrences(html, 'class="skill-group"'), 3);
  assert.match(html, /关于我/);
  assert.match(html, /技能/);
  assert.match(html, /项目/);
  assert.match(html, /联系方式/);
  assert.ok(html.includes(`© ${YEAR} 张旭锋`));
  assert.ok(!html.includes("undefined"));
});

test("renderPage 使用 content.js 中的关于我与项目文案", () => {
  const html = renderPage(profile, { year: YEAR });

  for (const sentence of profile.about) {
    assert.ok(html.includes(sentence));
  }

  for (const project of profile.projects) {
    assert.ok(html.includes(project.title));
    assert.ok(html.includes(project.description));
  }
});

test("renderPage 转义内容中的 HTML", () => {
  const hostileProfile = {
    ...profile,
    name: '<img src=x onerror="alert(1)">',
    about: ['5 < 6 & "引号"'],
    projects: [],
  };
  const html = renderPage(hostileProfile, { year: YEAR });

  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(html.includes("5 &lt; 6 &amp; &quot;引号&quot;"));
  assert.doesNotMatch(html, /<img/);
});

test("resolveTheme 优先使用合法的已保存主题", () => {
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
});

test("resolveTheme 在没有合法已保存主题时跟随系统", () => {
  assert.equal(resolveTheme(null, true), "dark");
  assert.equal(resolveTheme(undefined, false), "light");
  assert.equal(resolveTheme("", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("DARK", true), "dark");
});

test("toggleTheme 在浅色与深色之间切换", () => {
  assert.equal(toggleTheme("light"), "dark");
  assert.equal(toggleTheme("dark"), "light");
});

test("isExternalUrl 只识别 http(s) 链接", () => {
  assert.equal(isExternalUrl("https://github.com/apricity12345/super"), true);
  assert.equal(isExternalUrl("HTTP://example.com"), true);
  assert.equal(isExternalUrl("mailto:you@example.com"), false);
  assert.equal(isExternalUrl("#contact"), false);
});

test("externalLinkAttributes 只为外链补充 target 与 rel", () => {
  assert.equal(
    externalLinkAttributes("https://example.com"),
    ' target="_blank" rel="noopener noreferrer"',
  );
  assert.equal(externalLinkAttributes("mailto:you@example.com"), "");
});

test("renderPage 中所有 http(s) 外链都带 rel=noopener", () => {
  const html = renderPage(profile, { year: YEAR });
  const anchors = html.match(/<a\b[^>]*>/g) ?? [];
  const externalAnchors = anchors.filter((tag) => /href="https?:\/\//i.test(tag));

  assert.ok(externalAnchors.length >= 2);

  for (const tag of externalAnchors) {
    assert.match(tag, /target="_blank"/);
    assert.match(tag, /rel="noopener noreferrer"/);
  }
});

test("邮箱链接不强制打开新窗口", () => {
  const html = renderPage(profile, { year: YEAR });
  const mailAnchor = (html.match(/<a\b[^>]*>/g) ?? []).find((tag) =>
    tag.includes('href="mailto:'),
  );

  assert.ok(mailAnchor);
  assert.doesNotMatch(mailAnchor, /target="_blank"/);
});

test("renderProjectCard 对非外链不加 target 与 rel", () => {
  const card = renderProjectCard({
    title: "本地项目",
    description: "描述",
    url: "#projects",
    linkLabel: "查看",
  });

  assert.doesNotMatch(card, /target="_blank"/);
});

test("escapeHtml 转义引号与尖括号", () => {
  assert.equal(
    escapeHtml(`<a href="x">'&'</a>`),
    "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
  );
});
