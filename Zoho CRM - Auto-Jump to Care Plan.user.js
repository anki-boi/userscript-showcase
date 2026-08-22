// ==UserScript==
// @name         Zoho CRM - Auto-Jump to Care Plan
// @namespace    http://tampermonkey.net/
// @version      6.4
// @author       Jeyson Dagondon
// @description  Auto-scrolls to the Care Plan section once it's bound to the current patient
// @match        https://crm.zoho.com/crm/org695301973/tab/Contacts/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[CarePlan v6.4] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['CarePlan'] = { name: 'Zoho CRM - Auto-Jump to Care Plan', version: '6.4', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };

(function() {
    'use strict';

    const CARE_PLAN_ID = '4159382000086209513';
    const DEBUG = true;

    let lastContactId = null;

    function log(...args) {
        if (DEBUG) console.log('[CarePlan AutoJump]', ...args);
    }

    function getContactIdFromUrl() {
        const match = location.pathname.match(/Contacts\/(\d+)/);
        return match ? match[1] : null;
    }

    // The nav label element carries entity-id="<contact id>" as a real data binding —
    // unlike its text content, this can't be "stale leftover text from the last patient"
    // because Zoho sets it explicitly per-record. Comparing it to the URL's contact id
    // tells us for certain the panel is bound to the patient we're actually looking at.
    function panelIsBoundToContact(contactId) {
        const label = document.querySelector(`crm-related-list-label#rl_${CARE_PLAN_ID}`);
        return !!label && label.getAttribute('entity-id') === contactId;
    }

    function getRenderedSection() {
        const section = document.getElementById(`relatedList${CARE_PLAN_ID}`);
        if (!section) return null;
        return section.offsetHeight > 0 ? section : null;
    }

    function scrollToCarePlan(section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function pollForCarePlan(contactId) {
        let attempts = 0;
        const maxAttempts = 100; // ~50s ceiling, but exits the instant it's genuinely ready
        const interval = setInterval(() => {
            attempts++;
            if (panelIsBoundToContact(contactId)) {
                const section = getRenderedSection();
                if (section) {
                    clearInterval(interval);
                    log('panel confirmed bound to contact', contactId, '+ section rendered, scrolling (attempt', attempts, ')');
                    scrollToCarePlan(section);
                    return;
                }
            }
            if (attempts >= maxAttempts) {
                clearInterval(interval);
                log('gave up after', attempts, 'attempts for contact', contactId);
            }
        }, 200);
    }

    function checkForContactChange() {
        const currentId = getContactIdFromUrl();
        if (currentId && currentId !== lastContactId) {
            log('new contact detected:', currentId, '(was', lastContactId, ')');
            lastContactId = currentId;
            pollForCarePlan(currentId);
        }
    }

    setInterval(checkForContactChange, 500);
    checkForContactChange();
})();