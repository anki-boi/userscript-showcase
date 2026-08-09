// ==UserScript==
// @name         Zoho CRM Text Highlighter
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Highlight specific texts in Zoho CRM (no checkbox)
// @author       Jeyson Dagondon
// @match        *://*.crm.zoho.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[TextHL v2.2] boot');

(function() {
    'use strict';

    const TARGET_TEXTS = {
        'PIF': { color: 'green', bold: true },
        'rcvd': { color: 'green', bold: true },
        'due': { color: 'maroon', bold: true },
        'waiting to be signed': { color: 'maroon', bold: true },
        'sent, signed': { color: 'green', bold: true },
        'Sent, signed': { color: 'green', bold: true },
        'Products Ordered': { color: 'mediumblue', bold: true },
        'Date Shipped': { color: 'purple', bold: true },
        'TN': { color: 'purple', bold: true, exactMatch: true },
        'HH': { color: 'brown', bold: true, exactMatch: true }
    };

/*
VALID CSS COLOR OPTIONS:
Supports any valid CSS color: named colors, #Hex, rgb(), or hsl().
Standard CSS Named Colors:
aliceblue, antiquewhite, aqua, aquamarine, azure, beige, bisque, black, blanchedalmond, blue, blueviolet, brown, burlywood, cadetblue, chartreuse, chocolate, coral, cornflowerblue, cornsilk, crimson, cyan, darkblue, darkcyan, darkgoldenrod, darkgray, darkgreen, darkgrey, darkkhaki, darkmagenta, darkolivegreen, darkorange, darkorchid, darkred, darksalmon, darkseagreen, darkslateblue, darkslategray, darkslategrey, darkturquoise, darkviolet, deeppink, deepskyblue, dimgray, dimgrey, dodgerblue, firebrick, floralwhite, forestgreen, fuchsia, gainsboro, ghostwhite, gold, goldenrod, gray, green, greenyellow, grey, honeydew, hotpink, indianred, indigo, ivory, khaki, lavender, lavenderblush, lawngreen, lemonchiffon, lightblue, lightcoral, lightcyan, lightgoldenrodyellow, lightgray, lightgreen, lightgrey, lightpink, lightsalmon, lightseagreen, lightskyblue, lightslategray, lightslategrey, lightsteelblue, lightyellow, lime, limegreen, linen, magenta, maroon, mediumaquamarine, mediumblue, mediumorchid, mediumpurple, mediumseagreen, mediumslateblue, mediumspringgreen, mediumturquoise, mediumvioletred, midnightblue, mintcream, mistyrose, moccasin, navajowhite, navy, oldlace, olive, olivedrab, orange, orangered, orchid, palegoldenrod, palegreen, paleturquoise, palevioletred, papayawhip, peachpuff, peru, pink, plum, powderblue, purple, rebeccapurple, red, rosybrown, royalblue, saddlebrown, salmon, sandybrown, seagreen, seashell, sienna, silver, skyblue, slateblue, slategray, slategrey, snow, springgreen, steelblue, tan, teal, thistle, tomato, turquoise, violet, wheat, white, whitesmoke, yellow, yellowgreen
*/

    const IGNORE_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'BUTTON'];
    const HIGHLIGHT_CLASS = 'tm-highlighted';

    function shouldIgnoreNode(node) {
        if (!node.parentElement) return true;
        let parent = node.parentElement;
        while (parent) {
            if (IGNORE_TAGS.includes(parent.tagName)) return true;
            parent = parent.parentElement;
        }
        return false;
    }

    function createHighlightSpan(text, color, isBold) {
        const span = document.createElement('span');
        span.className = HIGHLIGHT_CLASS;
        span.textContent = text;
        span.style.color = color;
        span.style.fontWeight = isBold ? 'bold' : 'normal';
        span.style.display = 'inline';
        return span;
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function processTextNode(node) {
        const originalText = node.textContent;
        if (!originalText) return;

        let matchedConfig = null;
        let matchedText = null;

        for (const [text, cfg] of Object.entries(TARGET_TEXTS)) {
            if (cfg.exactMatch) {
                if (new RegExp(`\\b${escapeRegex(text)}\\b`).test(originalText)) {
                    matchedConfig = cfg;
                    matchedText = text;
                    break;
                }
            } else {
                if (originalText.includes(text)) {
                    matchedConfig = cfg;
                    matchedText = text;
                    break;
                }
            }
        }

        if (!matchedConfig) return;

        const pattern = matchedConfig.exactMatch
            ? `\\b${escapeRegex(matchedText)}\\b`
            : escapeRegex(matchedText);
        const regex = new RegExp(`(${pattern})`, 'g');
        const parts = originalText.split(regex);

        const fragment = document.createDocumentFragment();

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!part) continue;

            if (i % 2 === 1) {
                const highlightSpan = createHighlightSpan(part, matchedConfig.color, matchedConfig.bold);
                fragment.appendChild(highlightSpan);
            } else {
                fragment.appendChild(document.createTextNode(part));
            }
        }

        if (fragment.hasChildNodes() && node.parentNode) {
            node.parentNode.replaceChild(fragment, node);
        }
    }

    function scanAndProcess(rootNode) {
        if (!rootNode) return;

        const treeWalker = document.createTreeWalker(
            rootNode,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    if (shouldIgnoreNode(node)) return NodeFilter.FILTER_REJECT;
                    if (node.parentElement?.classList?.contains(HIGHLIGHT_CLASS)) return NodeFilter.FILTER_REJECT;
                    if (!node.textContent?.trim()) return NodeFilter.FILTER_SKIP;

                    const text = node.textContent;
                    for (const [target, cfg] of Object.entries(TARGET_TEXTS)) {
                        if (cfg.exactMatch) {
                            if (new RegExp(`\\b${escapeRegex(target)}\\b`).test(text)) return NodeFilter.FILTER_ACCEPT;
                        } else {
                            if (text.includes(target)) return NodeFilter.FILTER_ACCEPT;
                        }
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            }
        );

        const nodes = [];
        let currentNode;
        while ((currentNode = treeWalker.nextNode())) {
            if (document.contains(currentNode) &&
                !currentNode.parentElement?.classList?.contains(HIGHLIGHT_CLASS)) {
                nodes.push(currentNode);
            }
        }

        for (const textNode of nodes) {
            if (document.contains(textNode) &&
                textNode.parentNode &&
                !textNode.parentElement?.classList?.contains(HIGHLIGHT_CLASS)) {
                processTextNode(textNode);
            }
        }
    }

    function init() {
        scanAndProcess(document.body);

        let scanTimeout = null;

        const observer = new MutationObserver((mutations) => {
            let hasAdditions = mutations.some(m => m.addedNodes.length > 0);

            if (hasAdditions) {
                if (scanTimeout) clearTimeout(scanTimeout);
                scanTimeout = setTimeout(() => {
                    scanAndProcess(document.body);
                    scanTimeout = null;
                }, 100);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 0);
    }
})();