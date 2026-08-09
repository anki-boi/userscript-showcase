// ==UserScript==
// @name         Zoho CRM — Peptide SMS Templates
// @namespace    drjonesdc
// @version      5.5.7
// @author       Jeyson Dagondon
// @run-at       document-idle
// @match        https://crm.zoho.com/*
// @grant        none
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[RxSMS v5.5.7] boot');

// v5.5.2 CHANGES:
//  - Oral/Topical/Nasal med descriptions drop the quantity prefix (Jeyson,
//    2026-08-05): "30 capsules of X" -> "X capsules". Quantity now lives in
//    the concentration field only.
//
// v5.5.1 CHANGES:
//  - FIXED: Order Placed pane threw ReferenceError (placedClear was never
//    declared), which aborted openPanel() before the overlay mounted — the
//    Rx Templates button appeared dead. One missing const, whole panel down.
//
// v5.5 CHANGES:
//  - New "Order Placed" tab: click products to accumulate them into a list
//    (Oxford-comma grammar, click order preserved), live preview, Copy +
//    Clear. Pool is the curated ORDER_ITEMS short-name list (patient-facing
//    names), grouped Injectables / Oral-Topical-Nasal. No tracking field.
//
// v5.4 CHANGES:
//  - Non-injectable tracking templates no longer carry a "Full guide" link:
//    the default vial-guide fallback now applies ONLY to the Injectables
//    group and Supplies/Status/Admin (Blank Skeleton keeps it). Oral /
//    Topical / Nasal items and the 1 Month Stack emit no guide line unless
//    they have an explicit link (only the Warrior stacks do).
//  - GLP-1 static templates removed from the Tracking tab: GLP1_RX,
//    GLP1_VIALS, buildGLP1(), glp1DoseSentence(), doseFlags(), unitsFor()
//    deleted. The GLP-1 Parser tab is now the only GLP-1 path.
//  - OPEN ITEMS 1-2 (semaglutide vial spec, rounding policy) are moot with
//    the static GLP-1 tables gone; items on medication-line format and
//    B12 strength remain.
//
// v5.3 CHANGES:
//  - The "do not increase your dose" line now sits in its own paragraph in the
//    GLP-1 Parser tab message (blank line before and after), matching the
//    Tracking tab's existing output.
//
// v5.1 CHANGES:
//  - GLP-1 Parser now consumes the GLP-1 Dosing Calculator's order block
//    verbatim. No TN:/Concentration:/Total: lines required; the tracking
//    number comes from the panel field. Old labeled format still accepted.
//  - Parsed dose rows are rewritten into Carrie's approved sentence, so the
//    Parser tab and the Tracking tab now emit identical prose.
//  - FIXED: semaglutide concentrations were 2x too high in v5.0, which
//    halved every semaglutide unit count. Corrected against the calculator
//    catalog, which is internally consistent (conc x volume = vial total).
//    Added the 8 mg semaglutide vial that v5.0 was missing.
//  - FIXED: the "~" now sits on the mg, not the units. A patient draws an
//    exact whole number of units; it is the mg delivered that is approximate.
//    Matches the calculator's own convention.
//
// OPEN ITEMS BEFORE THIS GOES TO PATIENTS:
//  1. Medication-line format for non-GLP-1 products is unconfirmed.
//  2. Whether the B12/B6 strength shows to the patient is unconfirmed. The
//     Tracking tab shows the GLP-1 strength only; the Parser passes through
//     whatever the calculator emitted, which includes the vitamin.

(function () {
  'use strict';

  const RL_ID = '4159382000379742568'; // ABR RingCentral SMS related list

  // ---- TAB 1: REORDER TEMPLATES -------------------------------------------
  const PEPTIDES = {
    "CJC/IPA": {
      "2 Months / 1 vial": { vials: 1, nickname: "CJC/Ipamorelin" },
    },
    "Tesamorelin": {
      "4 Weeks / 2 vials": { vials: 2, nickname: "Tesamorelin" },
      "3 Months / 6 vials (ship 4)": { vials: 4, nickname: "Tesamorelin" },
    },
    "BPC-157": {
      "1 Month / 1 vial": { vials: 1, nickname: "BPC-157" },
      "3 Months / 3 vials (ship 2)": { vials: 2, nickname: "BPC-157" },
    },
    "GHK-Cu": {
      "6 Weeks / 1 vial": { vials: 1, nickname: "GHK-Cu" },
      "3 Months / 2 vials": { vials: 2, nickname: "GHK-Cu" },
    },
    "TB-500": {
      "1 Month / 3 vials": { vials: 3, nickname: "TB-500" },
    },
    "NAD+": {
      "Light / 1 vial": { vials: 1, nickname: "NAD+" },
      "Medium / 2 vials": { vials: 2, nickname: "NAD+" },
      "Strong / 4 vials": { vials: 4, nickname: "NAD+" },
    },
    "Wolverine Blend (BPC/TB500)": {
      "Light / 1 Month / 2 vials": { vials: 2, nickname: "Wolverine Blend" },
      "Standard / 1 Month / 3 vials": { vials: 3, nickname: "Wolverine Blend" },
      "Strong / 1 Month / 6 vials": { vials: 6, nickname: "Wolverine Blend" },
      "Light / 3 Months (ship 4)": { vials: 4, nickname: "Wolverine Blend" },
      "Standard / 3 Months (ship 6)": { vials: 6, nickname: "Wolverine Blend" },
      "Strong / 3 Months (ship 12)": { vials: 12, nickname: "Wolverine Blend" },
    },
    "Glow Blend (BPC/GHK/TB)": {
      "1 Month / 3 vials": { vials: 3, nickname: "Glow Blend" },
      "Strong / 1 Month / 6 vials": { vials: 6, nickname: "Glow Blend" },
    },
  };

  function buildReorderMessage(firstName, vials, nickname, address) {
    const vialWord = vials === 1 ? "vial is" : "vials are";
    return `Hi ${firstName}! This is Dr. Jones' Order Processing Department. Your ${vials} ${nickname} ${vialWord} due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.

Address on file:
${address}

Processing and shipping usually takes about 7 business days, so it should arrive in roughly a week.

If you will not be at this address within the next week or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.

One quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.`;
  }

  // ---- TAB 2: TRACKING AND DOSING -----------------------------------------
  // Links
  const GUIDE = 'https://securelinks.drdeanjones.com/2p8vjnvs';       // default vial guide
  const GUIDE_TA1 = 'https://securelinks.drdeanjones.com/3ak8bksx';   // Thymosin A-1 / MOTS-c
  const GUIDE_3MO = 'https://securelinks.drdeanjones.com/2p9xxt38';   // 3 Month Warrior
  const GUIDE_6MO = 'https://securelinks.drdeanjones.com/yrx6y9wz';   // 6 Month Warrior

  // Message parts
  const HEAD = "Hi {NAME}! This is Dr. Jones's Order Processing Team. We just received the tracking details for your order.\n{TRACKING}";
  const SPLIT_NOTE = "Tracking may take 1-2 business days to update after the label is created. If your order includes medications from different pharmacies, you'll receive separate tracking messages from each pharmacy, which may come from different phone numbers.";
  const NO_INC = 'Please do not increase your dose unless instructed by our Medical Team.';
  const PICKUP = '';
  const HELP = 'Questions about shipping or delivery? Just reply to this message.';
  const SIGN = 'Dr. Jones, D.C.';
  const STORE_FRIDGE = 'Store your troches in the fridge (2-8°C) in the original container, away from heat and moisture. Keep the lid tightly closed and use clean, dry hands when taking one out.';

  // Entry shape:
  //   med     - quantity + product name
  //   conc    - concentration string, now shown to the patient in parentheses
  //   medLine - overrides med/conc entirely with a prebuilt Medication line
  //   rx      - the full dosing instruction, mg included behind units
  //   link    - guide link (defaults to GUIDE)
  //   pickup  - true adds the pickup line under the tracking paragraph
  //   note    - extra paragraph appended after the rx block (storage etc.)
  //   body    - overrides med/conc/rx entirely for multi-medication stacks
  //   flags   - array of dose-math warnings, surfaced in the copy toast
  const TRACKING = {

"Injectables": {
      "CJC/Ipamorelin": {
        med: "1 CJC/Ipamorelin",
        conc: "1.5mg/2.5mg per mL, 6mL vial",
        rx: "Inject 7 units (0.1 mg CJC / 0.2 mg Ipamorelin) under the skin twice daily, for a total of 14 units per day. Use in the morning while fasted and again before bed. Use 5 days on and 2 days off.",
      },
      "GHK-Cu Injection / 1 vial": {
        med: "1 GHK-Cu",
        conc: "10mg/mL, 5mL vial",
        rx: "Inject 12 units (1.2 mg) under the skin once daily.",
      },
      "GHK-Cu Injection / 2 vials": {
        med: "2 GHK-Cu",
        conc: "10mg/mL, 5mL vials",
        rx: "Inject 12 units (1.2 mg) under the skin once daily.",
      },
      "Glow Blend / 3 vials": {
        med: "3 Glow Blend (BPC-157 / GHK-Cu / TB-500)",
        conc: "1.66mg/9mg/3.33mg per mL, 3mL vials",
        rx: "Inject 30 units (0.5 mg BPC-157 / 2.7 mg GHK-Cu / 1 mg TB-500) under the skin once daily.",
      },
      "Glow Blend / 6 vials (Strong)": {
        med: "6 Glow Blend (BPC-157 / GHK-Cu / TB-500)",
        conc: "1.66mg/9mg/3.33mg per mL, 3mL vials",
        rx: "Inject 60 units (1 mg BPC-157 / 5.4 mg GHK-Cu / 2 mg TB-500) under the skin once daily.",
      },
      "Wolverine Light / 2 vials": {
        med: "2 Wolverine Blend (BPC-157 / TB-500)",
        conc: "1.66mg/3.33mg per mL, 3mL vials",
        rx: "Inject 20 units (0.33 mg BPC-157 / 0.67 mg TB-500) under the skin once daily.",
      },
      "Wolverine Standard / 3 vials": {
        med: "3 Wolverine Blend (BPC-157 / TB-500)",
        conc: "1.66mg/3.33mg per mL, 3mL vials",
        rx: "Inject 30 units (0.5 mg BPC-157 / 1 mg TB-500) under the skin once daily.",
      },
      "Wolverine Strong / 6 vials": {
        med: "6 Wolverine Blend (BPC-157 / TB-500)",
        conc: "1.66mg/3.33mg per mL, 3mL vials",
        rx: "Inject 60 units (1 mg BPC-157 / 2 mg TB-500) under the skin once daily.",
      },
      "TB-500 / 3 vials": {
        med: "3 TB-500",
        conc: "3.33mg/mL, 3mL vials",
        rx: "Inject 30 units (1 mg) under the skin once daily.",
      },
      "BPC-157 Injection / 1 vial": {
        med: "1 BPC-157",
        conc: "3mg/mL, 5mL vial",
        rx: "Inject 17 units (0.51 mg) into the muscle once daily at the injury site as directed.",
      },
      "Tesamorelin / 2 vials": {
        med: "2 Tesamorelin",
        conc: "2mg/mL, 5mL vials",
        rx: "Inject 50 units (1 mg) under the skin every night at bedtime, Monday through Friday.",
      },
      "Tesamorelin / 4 vials": {
        med: "4 Tesamorelin",
        conc: "2mg/mL, 5mL vials",
        rx: "Inject 50 units (1 mg) under the skin every night at bedtime, Monday through Friday.",
      },
      "Tesamorelin / Ipamorelin Blend": {
        med: "1 Tesamorelin / Ipamorelin",
        conc: "3mg/2mg per mL, 5mL vial",
        rx: "Inject 20 units (0.6 mg Tesamorelin / 0.4 mg Ipamorelin) under the skin every night at bedtime, Monday through Friday.",
      },
      "Klow Blend (BPC/KPV/GHK/TB)": {
        med: "1 Klow Blend (BPC-157 / KPV / GHK-Cu / TB-500)",
        conc: "3mg/3mg/10mg/3mg per mL, 5mL vial",
        rx: "Inject 20 units (0.6 mg BPC-157 / 0.6 mg KPV / 2 mg GHK-Cu / 0.6 mg TB-500) under the skin in the morning, Monday through Friday.",
      },
      "SS-31": {
        med: "1 SS-31",
        conc: "50mg/mL, 6mL vial",
        rx: "Inject 40 units (20 mg) under the skin in the morning, 2 times per week.",
      },
      "NAD+ Light / 1 vial": {
        med: "1 NAD+",
        conc: "100mg/mL, 10mL vial",
        rx: "Inject 50 units (50 mg) under the skin 3 times per week.",
      },
      "NAD+ Medium / 2 vials": {
        med: "2 NAD+",
        conc: "100mg/mL, 10mL vials",
        rx: "Inject 100 units (100 mg) under the skin 3 times per week.",
      },
      "NAD+ Strong / 4 vials": {
        med: "4 NAD+",
        conc: "100mg/mL, 10mL vials",
        rx: "Inject 200 units (200 mg) under the skin 3 times per week. This is 2 mL total, so split it into two separate injections at different sites.",
      },
      "NAD+ Strong / 4 vials (alt. dosing)": {
        med: "4 NAD+",
        conc: "100mg/mL, 10mL vials",
        rx: "Inject 85 units (85 mg) under the skin once daily.",
      },
      "PT-141 Injection": {
        med: "1 PT-141",
        conc: "2mg/mL, 5mL vial",
        rx: "Inject 20 units (0.4 mg) under the skin once daily, Monday through Friday.",
      },
      "Thymosin Alpha-1 / 1 vial": {
        med: "1 Thymosin Alpha-1",
        conc: "5mg/mL, 5mL vial",
        rx: "Inject 20 units (1 mg) under the skin every day, Monday through Friday.",
        link: GUIDE_TA1,
      },
      "Thymosin Alpha-1 / 3 vials": {
        med: "3 Thymosin Alpha-1",
        conc: "5mg/mL, 5mL vials",
        rx: "Inject 20 units (1 mg) under the skin every day, Monday through Friday.",
        link: GUIDE_TA1,
      },
      "CB4211 (MOTS-c) / 8 kits": {
        med: "8 kits of CB4211 (MOTS-c)",
        conc: "10mg per kit, reconstituted with 1mL bacteriostatic water",
        rx: "Reconstitute one kit with 1 mL of bacteriostatic water, then inject 100 units (10 mg) under the skin once weekly in the morning or before your workout.",
        link: GUIDE_TA1,
      },
      "Epithalon": {
        med: "1 Epithalon",
        conc: "2mg/mL, 5mL vial",
        rx: "Inject 20 units (0.4 mg) under the skin once daily, Monday through Friday.",
      },
      "DSIP Injection": {
        med: "1 DSIP",
        conc: "1mg/mL, 5mL vial",
        rx: "Inject 20 units (0.2 mg) under the skin once nightly at bedtime, Monday through Friday.",
      },
      "DSIP / BPC / CJC Blend": {
        med: "1 DSIP / BPC-157 / CJC",
        conc: "1mg/2mg/2mg per mL, 5mL vial",
        rx: "Inject 20 units (0.2 mg DSIP / 0.4 mg BPC-157 / 0.4 mg CJC) under the skin once nightly at bedtime, Monday through Friday.",
      },
      "Kisspeptin": {
        med: "1 Kisspeptin",
        conc: "1mg/mL, 5mL vial",
        rx: "Inject 10 units (0.1 mg) under the skin two times per week.",
      },
      "Melanotan II": {
        med: "1 Melanotan II",
        conc: "2mg/mL, 5mL vial",
        rx: "Inject 12.5 units (0.25 mg) under the skin every other day until your desired color is reached, then maintain with 12.5 units (0.25 mg) twice weekly.",
      },
      "Pregnyl (HCG) / TRT": {
        med: "1 Pregnyl (HCG) 10,000 units",
        conc: "10,000 units in 10mL",
        rx: "Inject 25 to 50 units (250 to 500 IU) under the skin twice weekly in the morning or early afternoon.",
      },
      "Pregnyl (HCG) / Fertility or PCT": {
        med: "1 Pregnyl (HCG) 10,000 units",
        conc: "10,000 units in 10mL",
        rx: "Inject 100 to 200 units (1000 to 2000 IU) under the skin twice weekly for 2 to 4 weeks total, as directed.",
      },
    },

    "Oral / Topical / Nasal": {
      "5-Amino-1MQ Pill": {
        med: "5-Amino-1MQ capsules",
        conc: "50mg per capsule",
        // VERIFY: master table leaves the dosing cell blank, derived from "1 mth @1/day"
        rx: "Take 1 capsule (50 mg) by mouth once daily.",
        pickup: false,
      },
      "AOD-9604 Troche": {
        med: "AOD-9604 troches",
        conc: "600mcg per troche",
        rx: "Take 1 troche (600 mcg) in the morning while fasted, dissolving it between your cheek and gum. An optional second dose may be taken before bed.",
        note: STORE_FRIDGE,
        pickup: false,
      },
      "BPC-157 Pill": {
        med: "BPC-157 capsules",
        conc: "500mcg per capsule",
        rx: "Take 1 capsule (500 mcg) by mouth every morning with WATER ONLY.",
        pickup: false,
      },
      "BPC / KPV Pill": {
        med: "BPC / KPV capsules",
        conc: "500mcg/500mcg per capsule",
        rx: "Take 1 pill (500 mcg BPC / 500 mcg KPV each) per day, on an empty stomach.",
        pickup: false,
      },
      "Dihexa Pill": {
        med: "Dihexa pills",
        conc: "20mg per pill",
        rx: "Take 1 pill (20 mg) in the morning daily.",
        pickup: false,
      },
      "DSIP Troches": {
        med: "DSIP troches",
        conc: "300mcg per troche",
        rx: "Dissolve 1 troche (300 mcg) between your cheek and gum daily, 30 to 60 minutes before bed.",
        note: STORE_FRIDGE,
        pickup: false,
      },
      "GHK-Cu / Argireline / Leuphasyl Cream": {
        med: "GHK-Cu / Argireline / Leuphasyl cream",
        conc: "0.2% / 0.5% / 3%, 30g bottle",
        rx: "Apply 1 pea-sized amount to the face and 1 pea-sized amount to the neck every morning and/or evening daily.",
        pickup: false,
      },
      "Larazotide": {
        med: "Larazotide capsules",
        conc: "500mcg per capsule",
        rx: "Take 2 capsules (500 mcg each) daily in the morning or evening.",
        pickup: false,
      },
      "Methylene Blue 10mg (starting)": {
        med: "Methylene Blue pills",
        conc: "10mg per pill",
        rx: "Take 1 pill (10 mg) daily, in the morning or before your workout.",
        pickup: false,
      },
      "Methylene Blue 15mg (maintenance)": {
        med: "Methylene Blue pills",
        conc: "15mg per pill",
        rx: "Take 1 pill (15 mg) daily, in the morning or before your workout.",
        pickup: false,
      },
      "Methylene Blue 25mg (higher dose)": {
        med: "Methylene Blue pills",
        conc: "25mg per pill",
        rx: "Take 1 pill (25 mg) daily, in the morning or before your workout.",
        pickup: false,
      },
      "NAD+ Nasal Spray": {
        med: "NAD+ nasal spray",
        conc: "30mg/mL, 15mL bottle",
        rx: "Use 1 spray in each nostril every morning daily, up to 2 times per day as directed.",
        pickup: false,
      },
      "Nicotine Troches": {
        med: "Nicotine troches",
        conc: "1mg per troche",
        rx: "Take 1 troche (1 mg) in the morning or before a task as needed.",
        pickup: false,
      },
      "NMN / Apigenin Capsule": {
        med: "NMN / Apigenin capsules",
        conc: "250mg/150mg per capsule",
        rx: "Take 1 capsule (250 mg NMN / 150 mg apigenin) in the morning daily without food.",
        pickup: false,
      },
      "O-304 (new patient)": {
        med: "50mg capsules and 100mg capsules of O-304",
        conc: "50mg or 100mg per capsule",
        rx: "Take 1 capsule (50 mg) every morning daily for 14 days, then increase to 1 capsule (100 mg) every morning daily.",
        pickup: false,
      },
      "O-304 (refill)": {
        med: "O-304 capsules",
        conc: "100mg per capsule",
        rx: "Take 1 capsule (100 mg) every morning daily.",
        pickup: false,
      },
      "Phentermine": {
        med: "Phentermine pills",
        conc: "37.5mg per pill",
        rx: "Take 15 to 37.5 mg in the morning daily while fasted, or 1 to 2 hours after breakfast.",
        pickup: false,
      },
      "PT-141 Nasal Spray": {
        med: "PT-141 nasal spray",
        conc: "2.5mg/0.1mL, 3mL bottle",
        rx: "Use 1 to 3 sprays intranasally 45 to 60 minutes before sexual activity. Do not use more than 3 sprays per day.",
        pickup: false,
      },
      "Selank Nasal Spray": {
        med: "Selank nasal spray",
        conc: "7.5mg/mL, 6mL bottle",
        rx: "Use 1 spray in each nostril every morning daily, up to 3 times per day as needed.",
        pickup: false,
      },
      "Semax Nasal Spray": {
        med: "Semax nasal spray",
        conc: "7.5mg/mL, 6mL bottle",
        rx: "Use 1 spray in each nostril every morning or before a task daily, up to 3 times per day as directed.",
        pickup: false,
      },
      "SLU-PP-332 (new patient titration)": {
        med: "100mcg and 200mcg pills of SLU-PP-332",
        conc: "100mcg and 200mcg per pill",
        rx: "Take 1 x 100 mcg pill once daily in the morning or before exercise for the first 2 weeks. Then increase to 1 x 200 mcg pill once daily for the next 2 weeks. If tolerated, increase to 2 x 200 mcg pills daily, with one dose in the morning and one dose in the early afternoon. Do not take later in the day, as it may disrupt sleep. Food is not required.",
        pickup: false,
      },
      "SLU-PP-332 200mcg (maintenance)": {
        med: "SLU-PP-332 pills",
        conc: "200mcg per pill",
        rx: "Take 2 x 200 mcg pills daily, with one dose in the morning and one dose in the early afternoon. Do not take later in the day, as it may disrupt sleep. Food is not required.",
        pickup: false,
      },
      "Synapsin Nasal Spray": {
        med: "Synapsin (RG3 / Nicotinamide Riboside)",
        conc: "2mg/50mg per mL, 15mL vial",
        rx: "Use 1 spray in each nostril once daily.",
        pickup: false,
      },
      "Tesofensine Pill": {
        med: "Tesofensine tablets",
        conc: "500mcg per tablet",
        rx: "Take 1 tablet (500 mcg) every morning daily.",
        pickup: false,
      },
      "Thymosin Alpha-1 Nasal Spray": {
        med: "Thymosin Alpha-1 nasal spray",
        conc: "3mg/mL, 6mL vial",
        rx: "Use 1 spray in each nostril every morning or early afternoon daily, up to 2 times per day as directed.",
        pickup: false,
      },
    },

    "Stacks": {
      "1 Month Stack (SLU-PP, AOD, O-304)": {
        pickup: false,
        body: [
          "Medication: SLU-PP-332",
          "Take 1 x 100 mcg pill once daily in the morning or before exercise for weeks 1 and 2. From week 3, take 1 x 200 mcg pill once daily, and increase to 2 x 200 mcg pills daily if tolerated, one in the morning and one in the early afternoon. Do not take later in the day, as it may disrupt sleep.",
          "",
          "Medication: AOD-9604 Troche",
          "Take 1 troche (600 mcg) in the morning while fasted, dissolving it between your cheek and gum. An optional second dose may be taken before bed.",
          "",
          "Medication: O-304",
          "Take 1 capsule (50 mg) every morning daily for 14 days, then increase to 1 capsule (100 mg) every morning daily.",
        ].join("\n"),
      },
      "3 Month Warrior (SLU-PP, AOD, O-304)": {
        pickup: false,
        link: GUIDE_3MO,
        body: [
          "Medication: SLU-PP-332",
          "Take 1 x 100 mcg pill once daily in the morning or before exercise for weeks 1 and 2. From week 3, take 1 x 200 mcg pill once daily, and increase to 2 x 200 mcg pills daily if tolerated, one in the morning and one in the early afternoon. Do not take later in the day, as it may disrupt sleep.",
          "",
          "Medication: AOD-9604 Troche (start week 7)",
          "Take 1 troche (600 mcg) in the morning while fasted, dissolving it between your cheek and gum. An optional second dose may be taken before bed.",
          "",
          "Medication: O-304 (start week 7)",
          "Take 1 capsule (50 mg) every morning daily for 14 days, then increase to 1 capsule (100 mg) every morning daily.",
        ].join("\n"),
      },
      "6 Month Warrior (SLU-PP, AOD, O-304)": {
        pickup: false,
        link: GUIDE_6MO,
        body: [
          "Medication: SLU-PP-332",
          "Take 1 x 100 mcg pill once daily in the morning or before exercise for weeks 1 and 2. From week 3, take 1 x 200 mcg pill once daily, and increase to 2 x 200 mcg pills daily if tolerated, one in the morning and one in the early afternoon. Do not take later in the day, as it may disrupt sleep.",
          "",
          "Medication: AOD-9604 Troche (start week 9)",
          "Take 1 troche (600 mcg) in the morning while fasted, dissolving it between your cheek and gum. An optional second dose may be taken before bed.",
          "",
          "Medication: O-304 (start week 9)",
          "Take 1 capsule (50 mg) every morning daily for 14 days, then increase to 1 capsule (100 mg) every morning daily.",
        ].join("\n"),
      },
    },

    "Supplies / Status / Admin": {
      "Syringes + Supplies": {
        plain: `Hi {NAME}! This is Dr. Jones's Order Processing Team. We just received the tracking details for your order.

{TRACKING}

${SPLIT_NOTE}

Items:
20 pcs Syringes (0.5cc) + Alcohol Pads

${HELP}

${SIGN}`,
      },
      "Blank Skeleton (non-lab peptide)": {
        med: "[qty] [medication]",
        conc: "[concentration, vial size]",
        rx: "[full dosing instruction, mg in parentheses behind the unit count]",
      },
      "Peptide Still Processing": {
        plain: `Hi {NAME}! This is Dr. Jones's Order Processing Team. Your peptide is still processing in the pharmacy. It can take up to 7 business days for the them to compound and ship. We're keeping a close eye on it and will send your tracking info as soon as it's ready.`,
      },
      "Labs Done from Quest": {
        plain: `Hi! It's perfectly fine if you were able to complete your labs at Quest. We'll keep an eye out for your results and will update you once they come in.

We just sent you a LabX order just in case you need a redraw or haven't completed your labs yet. Let us know if you have any questions.`,
      },
      "AOD 3-Month Check-In": {
        plain: `Hi {NAME}, this is Dr. Jones' Medical Team. We are about to order your next set of AOD. We would like to check in how you are doing with AOD or if you wanted to switch to other peptides? Kindly let us know how to proceed. Thank you!`,
      },
      "PE Booking Link": {
        plain: `Perfect! You need to meet with [PE name], your patient advocate, so she can help you renew your [medication]. To make it easy for you to schedule a call with her, I've included a link below where you can choose a time that fits your schedule best. It does take a bit to load, so please be patient.

Here's her/his booking link: https://drdeanjones.com/book`,
      },
      "BHRT Supplements": {
        plain: `Hi there, this is Heather from Dr. Jones' Medical team. Here are the core BHRT support supplements Dr. Jones recommends to help your body balance and optimize hormone therapy

- DIM – 2 capsules daily with meals
https://securelinks.drdeanjones.com/2p9avaj6
- Vegan "Fish" Oil – 1 softgel at bedtime
https://securelinks.drdeanjones.com/y544z8um
- Ultima Replenisher Daily Electrolyte – At least 1 scoop on long fasting days
https://securelinks.drdeanjones.com/534n7ey2

Let us know if you have any questions!`,
      },
      "WL Supplements": {
        plain: `Hi {NAME}, this is Heather from Dr. Jones' Medical team.
Here are the core Weight Loss (WL) support supplements Dr. Jones recommends to optimize your results:

- Digestive Enzyme – 1–2 caps with each meal
https://securelinks.drdeanjones.com/vxnn54rs
- Resveratrol – 1 cap AM + 1 cap PM (250 mg each)
https://securelinks.drdeanjones.com/yckfjtux
- Curcumin – 3 caps AM + 3 caps PM
https://securelinks.drdeanjones.com/3b4tpj6m
- Magnesium (Glycinate) – 2 caps AM (240 mg)
https://securelinks.drdeanjones.com/apzk4m98
- Fiber (Unicity LiFiber) – 1 serving daily
https://securelinks.drdeanjones.com/2p92ab5s

Let us know if you have any questions!`,
      },
    },
  };

  // ---- DOSE SENTENCE RENDERING -------------------------------------------
  // Used by the GLP-1 Parser (and previously the static GLP-1 templates,
  // removed in v5.4). steps: [{ units, mg, approx, startWeek, endWeek }]
  // with endWeek null meaning open-ended. The "~" sits on the mg: the unit
  // count is a physical mark on the syringe and is always exact.
  function trimNum(n) {
    return parseFloat(Number(n).toFixed(4)).toString();
  }

  function renderDoseSentence(steps) {
    const single = steps.length === 1;
    const chunks = steps.map(function (s, i) {
      const first = i === 0;
      const last = i === steps.length - 1;
      const mgTxt = (s.approx ? '~' : '') + trimNum(s.mg) + ' mg';
      let when = '';
      if (!(single && s.startWeek === 1 && !s.endWeek)) {
        if (last && !s.endWeek) when = ' from week ' + s.startWeek + ' onward';
        else if (s.endWeek && s.endWeek !== s.startWeek) when = ' for weeks ' + s.startWeek + ' to ' + s.endWeek;
        else when = ' for week ' + s.startWeek;
      }
      return (first ? 'Inject ' : '') + s.units + ' units (' + mgTxt + ')' +
             (first ? ' under the skin weekly' : ' weekly') + when;
    });
    return chunks.join(', then ') + '. Use in the morning or evening.';
  }

  // ---- MESSAGE BUILDER ----------------------------------------------------
  function medicationLine(entry) {
    if (entry.medLine) return entry.medLine;
    if (entry.conc) return entry.med + ' (' + entry.conc + ')';
    return entry.med;
  }

  // Groups whose templates fall back to the default vial guide when no
  // explicit link is set. Non-injectable products (Oral/Topical/Nasal,
  // Stacks) get a guide link ONLY when the entry defines one — only the
  // Warrior stacks do.
  const GUIDE_DEFAULT_GROUPS = new Set(['Injectables', 'Supplies / Status / Admin']);

  function buildTrackingMessage(entry, firstName, tracking, carePlan, group) {
    const trk = (tracking && tracking.trim()) ? tracking.trim() : '[tracking number]';

    if (entry.plain) {
      return entry.plain.split('{NAME}').join(firstName).split('{TRACKING}').join(trk);
    }

    const parts = [];
    parts.push(HEAD.split('{NAME}').join(firstName).split('{TRACKING}').join(trk));
    parts.push('\n' + SPLIT_NOTE);
    if (entry.pickup) parts.push('\n' + PICKUP);

    let block = 'Dosing Instructions\n';
    if (entry.body) {
      block += entry.body;
    } else {
      block += 'Medication: ' + medicationLine(entry) + '\n' + entry.rx;
    }
    if (entry.note) block += '\n\n' + entry.note;
    parts.push('\n' + block);

    parts.push('\n' + NO_INC);
    const guide = entry.link || (GUIDE_DEFAULT_GROUPS.has(group) ? GUIDE : null);
    if (guide) parts.push('\nFull guide:\n' + guide);
    parts.push('\n' + HELP);
    parts.push('\n' + SIGN);

    return parts.join('\n');
  }

  // ---- TAB 3: GLP-1 ORDER PARSER ------------------------------------------
  // Accepts two shapes:
  //   (a) the GLP-1 Dosing Calculator order block, pasted verbatim
  //   (b) the older labeled block (TN: / Medication: / Concentration: / Total:)
  // The tracking number is never in the calculator output, so it falls back
  // to the panel's tracking field.

  // "2mg/0.5mL (2mL vial)" -> "2 mg/0.5 mL (2 mL vial)"
  function spaceUnits(str) {
    return str.replace(/([\d.])\s*(mg|mcg|mL|L|IU|units?)\b/gi, function (m, n, u) {
      const canon = { mg: 'mg', mcg: 'mcg', ml: 'mL', l: 'L', iu: 'IU', unit: 'unit', units: 'units' };
      return n + ' ' + (canon[u.toLowerCase()] || u);
    });
  }

  // "1 vial of Retatrutide 2mg/0.5mL (2mL vial) = 8mg total"
  function parseCalcMedLine(line) {
    const m = line.match(/^\s*(\d+)\s+vials?\s+of\s+(.+?)\s*=\s*(.+?)\s+total\s*$/i);
    if (!m) return null;
    const body = m[2].trim();
    const split = body.match(/^(.*?)\s+((?:[\d.]+\s*(?:mg|mcg|IU|units?)\b)[\s\S]*)$/i);
    return {
      vials: parseInt(m[1], 10),
      drug: split ? split[1].trim() : body,
      strength: split ? split[2].trim() : '',
      total: m[3].trim(),
      line: spaceUnits(m[1] + ' vial' + (parseInt(m[1], 10) === 1 ? '' : 's') +
                       ' of ' + body + ' = ' + m[3].trim() + ' total'),
    };
  }

  // "- Weeks 1 - 4: 1mg (25 units)"  /  "- Week 5: ~2.5mg (17 units)"
  const CALC_DOSE_RE = /^\s*-\s*Weeks?\s+(\d+)\s*(?:(?:-|to|–|—)\s*(\d+))?\s*:\s*(~?)\s*([\d.]+)\s*(mg|mcg)\s*\(\s*([\d.]+)\s*units?\s*\)\s*$/i;

  function parseGLP1(raw, firstName, panelTracking) {
    const grab = (re) => { const m = raw.match(re); return m ? m[1].trim() : null; };
    const warn = [];
    const info = [];

    // --- tracking -----------------------------------------------------------
    let tracking = grab(/^\s*TN:\s*(.+)$/mi);
    let trackingSource = 'TN: line';
    if (!tracking && panelTracking && panelTracking.trim()) {
      tracking = panelTracking.trim();
      trackingSource = 'panel field';
    }
    if (!tracking) { tracking = '[tracking number]'; warn.push('no tracking number'); }

    // --- medication line ----------------------------------------------------
    const rawMed = grab(/^\s*Medication:\s*(.+)$/mi);
    const concLine = grab(/^\s*Concentration:\s*(.+)$/mi);
    const totalLine = grab(/^\s*(?:Vial\s+)?Total(?:\s+mg)?:\s*(.+)$/mi);

    let medLine = null;
    let parsedMed = null;
    if (rawMed) {
      parsedMed = parseCalcMedLine(rawMed);
      if (parsedMed) {
        medLine = parsedMed.line;
      } else {
        // legacy shape: stitch the labeled pieces together
        let l = spaceUnits(rawMed);
        if (concLine) l += ' ' + spaceUnits(concLine);
        if (totalLine) l += ' = ' + spaceUnits(totalLine).replace(/\s*total\s*$/i, '') + ' total';
        else warn.push('no vial total');
        medLine = l;
      }
    } else {
      medLine = '[medication]';
      warn.push('no Medication line');
    }

    // --- dose rows ----------------------------------------------------------
    const bulletLines = [];
    const bulletRe = /^\s*-\s*(Weeks?\b.+)$/gmi;
    let bm;
    while ((bm = bulletRe.exec(raw)) !== null) bulletLines.push(bm[0].trim());

    const steps = [];
    let allParsed = bulletLines.length > 0;
    for (const line of bulletLines) {
      const d = line.match(CALC_DOSE_RE);
      if (!d) { allParsed = false; continue; }
      steps.push({
        startWeek: parseInt(d[1], 10),
        endWeek: d[2] ? parseInt(d[2], 10) : null,
        approx: d[3] === '~',
        mg: parseFloat(d[4]),
        unit: d[5].toLowerCase(),
        units: parseFloat(d[6]),
      });
    }

    let doseBlock;
    if (allParsed && steps.length) {
      if (steps.some(s => s.unit === 'mcg')) {
        allParsed = false;
      } else {
        steps.sort((a, b) => a.startWeek - b.startWeek);
        const last = steps[steps.length - 1];
        if (last.endWeek !== null) {
          info.push('final step written as "from week ' + last.startWeek +
                    ' onward" rather than ending at week ' + last.endWeek);
          last.endWeek = null;
        }
        steps.forEach(function (s) {
          if (s.units > 100) warn.push(trimNum(s.mg) + ' mg = ' + s.units + ' units, over a 1 mL syringe');
        });
        doseBlock = renderDoseSentence(steps);
      }
    }

    if (!doseBlock) {
      if (bulletLines.length) {
        warn.push('dose rows not in calculator format, copied verbatim');
        doseBlock = bulletLines.join('\n');
      } else {
        const plain = grab(/^\s*Dose:\s*(.+)$/mi);
        if (plain) { doseBlock = plain; warn.push('free-text dose, copied verbatim'); }
        else { doseBlock = '[dosing instructions]'; warn.push('no dose rows found'); }
      }
    }

    // --- sanity notes -------------------------------------------------------
    const freq = grab(/^\s*Frequency:\s*(.+)$/mi);
    if (freq && !/weekly/i.test(freq)) warn.push('Frequency says "' + freq + '" but the message says weekly');
    const dur = grab(/^\s*Estimated Duration:\s*(.+)$/mi);
    if (dur) info.push('calculator estimated ' + dur + ' of supply, not shown to the patient');
    if (parsedMed && parsedMed.vials > 1) info.push(parsedMed.vials + ' vials in this order');
    info.push('tracking from ' + trackingSource);

    const msg =
`Hi ${firstName}! This is Dr. Jones's Order Processing Team. We just received the tracking details for your order.
${tracking}

${SPLIT_NOTE}

Medication: ${medLine}
${doseBlock}

${NO_INC}

Full guide:
${GUIDE}

${HELP}

${SIGN}`;

    return { msg, warn, info };
  }

  // ---- TAB 4: SPLIT SHIPMENT NOTICE ---------------------------------------
  const SPLIT = {
    "CJC/IPA": {
      "2 Months / 1 vial": { med: "CJC/IPA", vials: 1, durationMonths: 2, nextVials: 1 },
    },
    "Tesamorelin": {
      "1 Month / 2 vials": { med: "Tesamorelin", vials: 2, durationMonths: 1, nextVials: 2 },
      "3 Months / ship 4 vials": { med: "Tesamorelin", vials: 4, durationMonths: 2, nextVials: 2 },
    },
    "BPC-157": {
      "1 Month / 1 vial": { med: "BPC-157", vials: 1, durationMonths: 1, nextVials: 1 },
      "3 Months / ship 2 vials": { med: "BPC-157", vials: 2, durationMonths: 2, nextVials: 1 },
    },
    "TB-500": {
      "1 Month / 3 vials": { med: "TB-500", vials: 3, durationMonths: 1, nextVials: 3 },
    },
    "Wolverine Blend (BPC/TB500)": {
      "Light / 1 Month / 2 vials": { med: "Wolverine Blend", vials: 2, durationMonths: 1, nextVials: 2 },
      "Standard / 1 Month / 3 vials": { med: "Wolverine Blend", vials: 3, durationMonths: 1, nextVials: 3 },
      "Strong / 1 Month / 6 vials": { med: "Wolverine Blend", vials: 6, durationMonths: 1, nextVials: 6 },
      "Light / 3 Months / ship 4 vials": { med: "Wolverine Blend", vials: 4, durationMonths: 2, nextVials: 2 },
      "Standard / 3 Months / ship 6 vials": { med: "Wolverine Blend", vials: 6, durationMonths: 2, nextVials: 3 },
      "Strong / 3 Months / ship 12 vials": { med: "Wolverine Blend", vials: 12, durationMonths: 2, nextVials: 6 },
    },
    "Glow Blend (BPC/GHK/TB)": {
      "1 Month / 3 vials": { med: "Glow Blend", vials: 3, durationMonths: 1, nextVials: 3 },
      "Strong / 1 Month / 6 vials": { med: "Glow Blend", vials: 6, durationMonths: 1, nextVials: 6 },
    },
  };

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function weeksOffsetFor(durationMonths) {
    if (durationMonths >= 2) return 6;
    return 3;
  }

  function addWeeks(date, weeks) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + weeks * 7);
    return d;
  }

  function formatMonthDay(d) {
    return MONTH_NAMES[d.getMonth()] + ' ' + d.getDate();
  }

  function buildSplitMessage(firstName, cfg, baseDate) {
    const offset = weeksOffsetFor(cfg.durationMonths);
    const nextDate = addWeeks(baseDate, offset);
    const vialWord = cfg.vials === 1 ? 'vial' : 'vials';
    const monthWord = cfg.durationMonths === 1 ? 'month' : 'months';
    const nextPhrase = (cfg.nextVials === cfg.vials)
      ? 'the next'
      : 'the next ' + cfg.nextVials + ' ' + (cfg.nextVials === 1 ? 'vial' : 'vials');

    return `Hi ${firstName}, this is Dr. Jones' Order Processing Department with a quick update.

Your ${cfg.med} order just went over to our compounding pharmacy. Once the peptides are compounded, we'll send you the tracking number.

Quick heads up: to keep your medication at its best, the pharmacy splits this order into separate shipments. This shipment has ${cfg.vials} ${vialWord} lasting you ${cfg.durationMonths} ${monthWord}, and ${nextPhrase} should be ordered around the week of ${formatMonthDay(nextDate)}.

We'll always check in before any future shipment goes out, just to confirm the timing works and your address is still current.`;
  }

  // ---- TAB 5: ORDER PLACED (multi-select) ----------------------------------
  // Curated patient-facing short names. Click-to-add in the panel; click
  // order is preserved in the message. Add new products here (one line each).
  const ORDER_ITEMS = {
    "Injectables": [
      "CJC/Ipamorelin",
      "Tesamorelin",
      "Tesamorelin / Ipamorelin Blend",
      "BPC-157",
      "GHK-Cu",
      "TB-500",
      "NAD+",
      "Wolverine Blend",
      "Glow Blend",
      "Klow Blend",
      "SS-31",
      "PT-141",
      "Thymosin Alpha-1",
      "MOTS-c (CB4211)",
      "Epithalon",
      "DSIP",
      "DSIP / BPC / CJC Blend",
      "Kisspeptin",
      "Melanotan II",
      "Pregnyl (HCG)",
    ],
    "Oral / Topical / Nasal": [
      "5-Amino-1MQ",
      "AOD-9604",
      "BPC-157 Pill",
      "BPC / KPV Pill",
      "Dihexa",
      "DSIP Troches",
      "GHK-Cu / Argireline / Leuphasyl Cream",
      "Larazotide",
      "Methylene Blue",
      "NAD+ Nasal Spray",
      "Nicotine Troches",
      "NMN / Apigenin",
      "O-304",
      "Phentermine",
      "PT-141 Nasal Spray",
      "Selank Nasal Spray",
      "Semax Nasal Spray",
      "SLU-PP-332",
      "Synapsin Nasal Spray",
      "Tesofensine",
      "Thymosin Alpha-1 Nasal Spray",
    ],
  };

  // "A", "A and B", "A, B, and C" (Oxford comma)
  function formatOrderList(items) {
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + ' and ' + items[1];
    return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
  }

  function buildOrderPlacedMessage(firstName, items) {
    return `Hi ${firstName}! This is Dr. Jones' Order Processing Team. Your ${formatOrderList(items)} order has been placed and is currently being processed.

Orders can take up to one week to complete. Once the pharmacy has finished processing your order, you'll receive your shipping confirmation, tracking information, and dosing instructions directly from the pharmacy. Please keep an eye on both your email and text messages, as these updates may come from the pharmacy instead of Dr. Jones' team.

Thank you!`;
  }

  // ---- FIELD EXTRACTION ----------------------------------------------------
  function readCxValue(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const v = el.getAttribute('cx-prop-value');
      if (v && v.trim()) return v.trim();
      const txt = el.textContent;
      if (txt && txt.trim()) return txt.trim();
    }
    return null;
  }

  function getFullName() {
    return readCxValue([
      '#titlecard_LASTNAME',
      '[data-zcqa="value_LASTNAME"]',
      '#title_LASTNAME crux-text-component',
      // Zoho drifted the detail-view name field LASTNAME -> FULLNAME (2026-08-04)
      '#titlecard_FULLNAME',
      '[data-zcqa="value_FULLNAME"]',
      '#title_FULLNAME crux-text-component',
    ]);
  }

  function getFirstName() {
    const full = getFullName();
    return full ? full.trim().split(/\s+/)[0] : null;
  }

  function getAddress() {
    return readCxValue([
      '[data-zcqa="value_MailingStreet"]',
      '#subvalue_CONTACTCF50',
      '#value_CONTACTCF50 crux-text-component',
    ]);
  }

  // ---- CLIPBOARD -----------------------------------------------------------
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('execCommand failed'));
      } catch (e) {
        document.body.removeChild(ta);
        reject(e);
      }
    });
  }

  function toast(msg, isError, ms) {
    const hold = ms || 1800;
    const t = document.createElement('div');
    t.className = 'pt-toast' + (isError ? ' pt-toast-err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, hold);
    setTimeout(function () { t.remove(); }, hold + 400);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- STYLES --------------------------------------------------------------
  const CSS = `
  :root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}
  .pt-btn {
    display: inline-flex; align-items: center; justify-content: center;
    box-sizing: border-box; vertical-align: middle;
    height: 28px; padding: 0 12px; margin-right: 8px; cursor: pointer;
    border: 1px solid var(--ds-accent, #2d7ff9); border-radius: 4px; background: var(--ds-surface, #fff);
    font-size: 13px; font-weight: 500; color: var(--ds-accent, #2d7ff9);
    line-height: 1; white-space: nowrap; text-decoration: none;
  }
  .pt-btn:hover { background: var(--ds-accent, #2d7ff9); color: var(--ds-accent-text, #fff); }
  .pt-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.35);
    z-index: 2147483646; display: flex; align-items: center; justify-content: center;
  }
  .pt-panel {
    background: var(--ds-surface, #fff); border-radius: 8px; width: 480px; max-height: 84vh;
    display: flex; flex-direction: column;
    font-family: system-ui, sans-serif; color: var(--ds-text, #222);
    box-shadow: 0 8px 32px rgba(0,0,0,.25);
  }
  .pt-head { padding: 14px 18px 0; }
  .pt-head h3 { margin: 0 0 4px; font-size: 15px; }
  .pt-meta { font-size: 11px; color: var(--ds-muted, #666); line-height: 1.5; }
  .pt-meta b { color: #222; }
  .pt-warn { font-size: 11px; color: var(--ds-warn, #b45309); margin-top: 6px; }
  .pt-track { margin: 10px 0 0; }
  .pt-track label, .pt-date label {
    display: block; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .04em; color: #888; margin-bottom: 3px;
  }
  .pt-track input, .pt-date input {
    width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 12px;
    border: 1px solid var(--ds-border, #c4c9d1); border-radius: 4px; font-family: inherit;
  }
  .pt-date { margin: 8px 0 0; }
  .pt-mode {
    margin: 9px 0 0; display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: #333; padding: 6px 8px;
    background: var(--ds-surface2, #f5f6f8); border: 1px solid var(--ds-border, #e3e6ea); border-radius: 4px;
  }
  .pt-mode input { margin: 0; }
  .pt-mode span { font-size: 11px; color: #777; }
  .pt-tabs { display: flex; gap: 4px; padding: 12px 18px 0; border-bottom: 1px solid var(--ds-border, #e3e6ea); }
  .pt-tab {
    padding: 6px 9px; cursor: pointer; font-size: 11px; font-weight: 600;
    color: #666; border: 1px solid transparent; border-bottom: none;
    border-radius: 4px 4px 0 0; margin-bottom: -1px; background: #f5f6f8;
  }
  .pt-tab.pt-active {
    background: var(--ds-surface, #fff); color: var(--ds-accent, #2d7ff9);
    border-color: var(--ds-border, #e3e6ea); border-bottom-color: var(--ds-surface, #fff);
  }
  .pt-body { overflow-y: auto; padding: 12px 18px; flex: 1; }
  .pt-pane { display: none; }
  .pt-pane.pt-active { display: block; }
  .pt-group { margin-bottom: 10px; }
  .pt-group-title {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .04em; color: #888; margin-bottom: 4px;
  }
  .pt-item {
    padding: 6px 8px; border: 1px solid #e3e6ea; border-radius: 4px;
    margin-bottom: 4px; cursor: pointer; font-size: 13px;
  }
  .pt-item:hover { background: #f0f6ff; border-color: #2d7ff9; }
  .pt-item.pt-flagged { border-left: 3px solid #b45309; }
  .pt-chip {
    display: inline-block; padding: 4px 9px; margin: 0 4px 4px 0;
    border: 1px solid #c4c9d1; border-radius: 12px; cursor: pointer;
    font-size: 12px; color: #333; background: #fff;
  }
  .pt-chip:hover { border-color: #2d7ff9; background: #f0f6ff; }
  .pt-chip.pt-on { background: #2d7ff9; color: #fff; border-color: #2d7ff9; }
  .pt-placed-list {
    font-size: 13px; font-weight: 600; color: #2d7ff9;
    min-height: 18px; margin-bottom: 8px; line-height: 1.4;
  }
  .pt-placed-preview {
    width: 100%; box-sizing: border-box; min-height: 150px;
    padding: 8px; font-size: 12px; line-height: 1.5; resize: vertical;
    border: 1px solid #c4c9d1; border-radius: 4px;
    font-family: system-ui, sans-serif; background: #fafbfc; color: #333;
  }
  .pt-placed-actions { display: flex; gap: 6px; margin-top: 8px; }
  .pt-placed-copy, .pt-placed-clear {
    flex: 1; padding: 8px; cursor: pointer; font-size: 13px; font-weight: 600;
    border-radius: 4px; border: 1px solid #2d7ff9;
  }
  .pt-placed-copy { background: #2d7ff9; color: #fff; }
  .pt-placed-copy:disabled { background: #b9cdf7; border-color: #b9cdf7; cursor: not-allowed; }
  .pt-placed-clear { background: #fff; color: #2d7ff9; }
  .pt-foot { padding: 0 18px 14px; }
  .pt-close {
    width: 100%; padding: 7px; cursor: pointer;
    border: 1px solid #c4c9d1; border-radius: 4px; background: #f5f6f8; font-size: 13px;
  }
  .pt-toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #1f2937; color: #fff; padding: 9px 16px; border-radius: 5px;
    font-family: system-ui, sans-serif; font-size: 13px; z-index: 2147483647;
    transition: opacity .35s; opacity: 1; max-width: 80vw;
  }
  .pt-toast-err { background: #b91c1c; }
  `;

  function injectCSS() {
    if (document.getElementById('pt-style')) return;
    const s = document.createElement('style');
    s.id = 'pt-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- PANEL ---------------------------------------------------------------
  function openPanel() {
    injectCSS();

    let firstName = getFirstName();
    let address = getAddress();
    const missing = [];
    if (!firstName) missing.push('first name');
    if (!address) missing.push('address');

    if (missing.length) {
      const manual = prompt(
        'Could not auto-read ' + missing.join(' and ') +
        '.\n\nEnter as: FirstName | Full Address',
        (firstName || '') + ' | ' + (address || '')
      );
      if (manual === null) return;
      const parts = manual.split('|');
      firstName = (parts[0] || '').trim() || firstName;
      address = (parts[1] || '').trim() || address;
      if (!firstName) { alert('First name is required.'); return; }
      address = address || '[address]';
    }

    const overlay = document.createElement('div');
    overlay.className = 'pt-overlay';

    const panel = document.createElement('div');
    panel.className = 'pt-panel';

    const today = new Date();
    const isoToday = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');

    let html = '<div class="pt-head">' +
      '<h3>SMS Templates <span style="font-weight:400;color:#999;font-size:11px;">v5.5.2</span></h3>' +
      '<div class="pt-meta">Patient: <b>' + esc(firstName) + '</b><br>Address: <b>' + esc(address) + '</b></div>';
    if (missing.length) html += '<div class="pt-warn">Fields entered manually, auto-read failed.</div>';
    html += '<div class="pt-track"><label>Tracking number (Tracking &amp; Dosing only)</label>' +
      '<input type="text" class="pt-track-input" placeholder="Paste tracking number or link"></div>' +
      '<div class="pt-date"><label>Order date (Split Shipment only)</label>' +
      '<input type="date" class="pt-date-input" value="' + isoToday + '"></div>' +
      '<label class="pt-mode"><input type="checkbox" class="pt-careplan-input" disabled>' +
      'Care Plan version <span>(inactive in v5.0, concentration is always shown)</span></label>' +
      '</div>';

    html += '<div class="pt-tabs">' +
      '<div class="pt-tab pt-active" data-pane="placed">Order Placed</div>' +
      '<div class="pt-tab" data-pane="tracking">Tracking &amp; Dosing</div>' +
      '<div class="pt-tab" data-pane="glp1">GLP-1 Parser</div>' +
      '<div class="pt-tab" data-pane="reorder">Reorder</div>' +
      '<div class="pt-tab" data-pane="split">Split Shipment</div>' +
      '</div><div class="pt-body">';

    // Order Placed pane (multi-select accumulator)
    html += '<div class="pt-pane pt-active" data-pane="placed">' +
      '<div class="pt-placed-list">Click products to add them to the list.</div>' +
      '<textarea class="pt-placed-preview" readonly placeholder="Your message will appear here as you click products."></textarea>' +
      '<div class="pt-placed-actions">' +
      '<button class="pt-placed-copy" disabled>Copy Message</button>' +
      '<button class="pt-placed-clear">Clear</button>' +
      '</div>';
    for (const [grp, names] of Object.entries(ORDER_ITEMS)) {
      html += '<div class="pt-group" style="margin-top:10px;"><div class="pt-group-title">' + esc(grp) + '</div>';
      for (const name of names) {
        html += '<span class="pt-chip" data-name="' + esc(name) + '">' + esc(name) + '</span>';
      }
      html += '</div>';
    }
    html += '</div>';

    // Reorder pane
    html += '<div class="pt-pane" data-pane="reorder">';
    for (const [pep, variants] of Object.entries(PEPTIDES)) {
      html += '<div class="pt-group"><div class="pt-group-title">' + esc(pep) + '</div>';
      for (const label of Object.keys(variants)) {
        html += '<div class="pt-item" data-kind="reorder" data-pep="' + esc(pep) +
          '" data-var="' + esc(label) + '">' + esc(label) + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // Tracking pane
    html += '<div class="pt-pane" data-pane="tracking">';
    for (const [grp, items] of Object.entries(TRACKING)) {
      html += '<div class="pt-group"><div class="pt-group-title">' + esc(grp) + '</div>';
      for (const [label, entry] of Object.entries(items)) {
        const flagged = (entry.flags && entry.flags.length) ? ' pt-flagged' : '';
        const suffix = flagged ? ' <span style="color:#b45309;font-size:11px;">check dose</span>' : '';
        html += '<div class="pt-item' + flagged + '" data-kind="tracking" data-grp="' + esc(grp) +
          '" data-var="' + esc(label) + '">' + esc(label) + suffix + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // GLP-1 parser pane
    html += '<div class="pt-pane" data-pane="glp1">' +
      '<div class="pt-group-title">Paste order block</div>' +
      '<textarea class="pt-glp1-input" placeholder="Paste the GLP-1 Dosing Calculator order block straight in. Tracking comes from the field above." ' +
      'style="width:100%;box-sizing:border-box;min-height:200px;padding:8px;font-size:12px;' +
      'font-family:ui-monospace,Menlo,Consolas,monospace;border:1px solid #c4c9d1;border-radius:4px;' +
      'resize:vertical;"></textarea>' +
      '<div class="pt-glp1-warn" style="font-size:11px;color:#b45309;margin:6px 0;min-height:14px;"></div>' +
      '<button class="pt-glp1-go" style="width:100%;padding:8px;cursor:pointer;border:1px solid #2d7ff9;' +
      'border-radius:4px;background:#2d7ff9;color:#fff;font-size:13px;font-weight:600;">' +
      'Parse &amp; Copy</button>' +
      '</div>';

    // Split shipment pane
    html += '<div class="pt-pane" data-pane="split">';
    for (const [pep, variants] of Object.entries(SPLIT)) {
      html += '<div class="pt-group"><div class="pt-group-title">' + esc(pep) + '</div>';
      for (const label of Object.keys(variants)) {
        html += '<div class="pt-item" data-kind="split" data-pep="' + esc(pep) +
          '" data-var="' + esc(label) + '">' + esc(label) + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    html += '</div><div class="pt-foot"><button class="pt-close">Close</button></div>';
    panel.innerHTML = html;

    const trackInput = panel.querySelector('.pt-track-input');
    const dateInput = panel.querySelector('.pt-date-input');
    const careInput = panel.querySelector('.pt-careplan-input');

    panel.querySelectorAll('.pt-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        panel.querySelectorAll('.pt-tab').forEach(function (t) { t.classList.remove('pt-active'); });
        panel.querySelectorAll('.pt-pane').forEach(function (p) { p.classList.remove('pt-active'); });
        tab.classList.add('pt-active');
        panel.querySelector('.pt-pane[data-pane="' + tab.dataset.pane + '"]').classList.add('pt-active');
      });
    });

    const placedList = panel.querySelector('.pt-placed-list');
    const placedPreview = panel.querySelector('.pt-placed-preview');
    const placedCopy = panel.querySelector('.pt-placed-copy');
    const placedClear = panel.querySelector('.pt-placed-clear');
    const placedChips = Array.from(panel.querySelectorAll('.pt-chip'));
    const selected = [];

    function placedSync() {
      placedList.textContent = selected.length
        ? 'Selected: ' + formatOrderList(selected)
        : 'Click products to add them to the list.';
      placedPreview.value = selected.length
        ? buildOrderPlacedMessage(firstName, selected)
        : '';
      placedCopy.disabled = selected.length === 0;
    }

    placedChips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        const name = chip.dataset.name;
        const i = selected.indexOf(name);
        if (i >= 0) {
          selected.splice(i, 1);
          chip.classList.remove('pt-on');
        } else {
          selected.push(name);
          chip.classList.add('pt-on');
        }
        placedSync();
      });
    });

    placedCopy.addEventListener('click', function () {
      if (!selected.length) return;
      const msg = buildOrderPlacedMessage(firstName, selected);
      copyText(msg).then(
        function () {
          toast('Copied: Order placed — ' + formatOrderList(selected));
          overlay.remove();
        },
        function () { toast('Copy failed, check console', true); console.log(msg); }
      );
    });

    placedClear.addEventListener('click', function () {
      selected.length = 0;
      placedChips.forEach(function (c) { c.classList.remove('pt-on'); });
      placedSync();
    });

    panel.querySelectorAll('.pt-item').forEach(function (el) {
      el.addEventListener('click', function () {
        let msg, label;
        if (el.dataset.kind === 'reorder') {
          const cfg = PEPTIDES[el.dataset.pep][el.dataset.var];
          msg = buildReorderMessage(firstName, cfg.vials, cfg.nickname, address);
          label = cfg.nickname + ' × ' + cfg.vials;
        } else if (el.dataset.kind === 'split') {
          const cfg = SPLIT[el.dataset.pep][el.dataset.var];
          const parts = (dateInput.value || '').split('-');
          const base = parts.length === 3
            ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
            : new Date();
          msg = buildSplitMessage(firstName, cfg, base);
          label = cfg.med + ' split notice';
        } else {
          const entry = TRACKING[el.dataset.grp][el.dataset.var];
          msg = buildTrackingMessage(entry, firstName, trackInput.value, careInput.checked, el.dataset.grp);
          label = el.dataset.var;
          if (entry.flags && entry.flags.length) {
            label += ' :: CHECK DOSE: ' + entry.flags.join(' | ');
            console.warn('[Rx Templates] ' + el.dataset.var, entry.flags);
          }
        }
        const risky = /CHECK DOSE/.test(label);
        copyText(msg).then(
          function () { toast('Copied: ' + label, risky, risky ? 7000 : 1800); },
          function () { toast('Copy failed, check console', true); console.log(msg); }
        );
        overlay.remove();
      });
    });

    const glp1Input = panel.querySelector('.pt-glp1-input');
    const glp1Warn = panel.querySelector('.pt-glp1-warn');
    panel.querySelector('.pt-glp1-go').addEventListener('click', function () {
      const raw = glp1Input.value;
      if (!raw.trim()) { glp1Warn.textContent = 'Paste an order block first.'; return; }
      const { msg, warn, info } = parseGLP1(raw, firstName, trackInput.value);
      let note = '';
      if (warn.length) note += 'CHECK: ' + warn.join(' | ');
      if (info.length) note += (note ? '\n' : '') + info.join(' | ');
      glp1Warn.textContent = note;
      glp1Warn.style.color = warn.length ? '#b91c1c' : '#666';
      if (warn.length) console.warn('[Rx Templates] GLP-1 parser', warn);
      copyText(msg).then(
        function () {
          toast(warn.length ? 'Copied, but CHECK: ' + warn.join(' | ') : 'Copied GLP-1 message',
                warn.length, warn.length ? 7000 : 1800);
          if (!warn.length) overlay.remove();
        },
        function () { toast('Copy failed, check console', true); console.log(msg); }
      );
    });

    panel.querySelector('.pt-close').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    trackInput.focus();
  }

  // ---- BUTTON INJECTION ----------------------------------------------------
  function addButton() {
    const actions = document.querySelector('crm-detailview-actions');
    if (!actions) return;
    if (actions.querySelector('.pt-btn')) return;

    injectCSS();
    const btn = document.createElement('a');
    btn.className = 'pt-btn';
    btn.href = 'JavaScript:void(0);';
    btn.title = 'SMS templates';
    btn.textContent = 'Rx Templates';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openPanel();
    });

    const sendMail = actions.querySelector('#btn_send_mail');
    if (sendMail) {
      actions.insertBefore(btn, sendMail);
    } else {
      actions.insertBefore(btn, actions.firstChild);
    }
  }

  new MutationObserver(addButton).observe(document.documentElement, { childList: true, subtree: true });
  addButton();
})();