import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/** Selectors likely to hold the page body, most specific first. Add your CMS's container at the front. */
const CONTENT_SELECTORS = ["#sitebody", "[role='main']", "#pagebody", ".pageContent", "#content", "main", "article", ".content"];

/** Chrome: navigation, translate widgets, share bars, and other boilerplate. */
const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "nav",
  "header",
  "footer",
  "form",
  "select",
  "button",
  "input",
  "#google_translate_element",
  ".goog-te-banner-frame",
  ".skiptocontent",
  ".skip",
  ".breadcrumb",
  ".breadcrumbs",
  "[aria-hidden='true']",
  ".sr-only",
  ".visually-hidden",
  ".sharebar",
  ".share",
  ".social",
  ".print",
  ".alert_strip",
  ".alertStrip",
  "#alertWrap",
  ".backToTop",
  ".pageNav",
  ".sidebar",
  ".subnav",
  ".leftNav",
  "#leftNav",
  // Theme chrome seen on Granicus Vision sites (common for US local government)
  "#siteheader",
  ".tp-header-area",
  ".tp-header-height",
  ".tp-main-menu-mobile",
  ".tp-main-menu-content",
  ".MegaMenuContent",
  ".body-overlay",
  ".tp-footer-top-area",
  "#footer-one-page",
  "#page_footer",
  ".breadcrumb__content",
  ".tp-btn-xl",
  ".wcag_only",
  "[class*='offcanvas']",
  ".tp-header-top",
];

export interface ExtractedHtml {
  title: string;
  markdown: string;
  /** How the content was located. */
  method: "selector" | "readability" | "body";
}

/** Trailing " | Site Name" or " – Site Name" on page titles; only stripped when a real title remains. */
const SITE_TITLE_SUFFIX = /\s*[|–]\s*[^|–]{2,80}$/;

function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  td.use(gfm);
  // Drop images entirely; alt text is rarely useful for Q&A.
  td.addRule("images", { filter: "img", replacement: () => "" });
  return td;
}

function cleanMarkdown(md: string): string {
  return md
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*Show\/Hide\s*$/gm, "")
    .trim();
}

export function htmlToMarkdown(html: string, url: string): ExtractedHtml {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const rawTitle = doc.title?.trim() ?? "";
  let title = rawTitle.replace(SITE_TITLE_SUFFIX, "").trim();

  let container: Element | null = null;
  for (const sel of CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && (el.textContent ?? "").trim().length > 80) {
      container = el;
      break;
    }
  }

  let method: ExtractedHtml["method"] = "selector";
  let contentHtml: string;

  if (container) {
    // Grab the page title before stripping, since it sits inside a <header> on this theme.
    const titleEl = container.querySelector(".breadcrumb__title, .titlewidget-title, h1.title, header h1, h1");
    if (titleEl?.textContent?.trim()) title = titleEl.textContent.replace(/\s+/g, " ").trim();
    for (const sel of STRIP_SELECTORS) {
      container.querySelectorAll(sel).forEach((el) => el.remove());
    }
    contentHtml = container.innerHTML;
  } else {
    const article = new Readability(doc.cloneNode(true) as Document).parse();
    if (article?.content) {
      method = "readability";
      contentHtml = article.content;
      if (article.title) title = article.title.replace(SITE_TITLE_SUFFIX, "").trim();
    } else {
      method = "body";
      for (const sel of STRIP_SELECTORS) doc.body.querySelectorAll(sel).forEach((el) => el.remove());
      contentHtml = doc.body.innerHTML;
    }
  }

  const markdown = cleanMarkdown(makeTurndown().turndown(contentHtml));
  return { title: title || url, markdown, method };
}
