-- PR 1.5 (cont.) — Hindi topic labels, keyed by TITLE so they survive promotion.
--
-- WHY THIS EXISTS. pr1_04 seeds by topic_id, and topic ids are generated per
-- environment by each environment's own ingest. Dev's 115 ids do not exist on
-- UAT, and topic_translations.topic_id is FK-constrained to topics(id), so that
-- migration aborted the whole promotion until it was taught to skip ids it
-- cannot find. Even with the skip it seeds NOTHING outside Dev, because there
-- is no id in common.
--
-- Matching on title is the portable key: the Hindi label was written for a
-- specific English label, so wherever that English label appears the same Hindi
-- applies. Topics that exist in one environment and not another are simply
-- skipped, and a topic with no row falls back to topics.title, which is what
-- topic_title_for() already does.
--
-- UAT SHARES ZERO TITLES WITH DEV. Its ten topics come from its own ingest, so
-- these are new translations rather than a copy of pr1_04's. Same recorded
-- decision applies: machine-generated, shipped without native-speaker review at
-- the product owner's explicit direction, and flagged as such in review_status
-- so a later human pass can correct rows in place.
--
-- Same translation conventions as pr1_04:
--   * neutral register, because a topic label frames every question inside it;
--   * where the ENGLISH carries a framing, the Hindi MIRRORS it rather than
--     softening or sharpening it -- re-framing during translation would be the
--     platform editorialising. "Settlement Policies" stays बस्ती नीतियाँ, the
--     standard Hindi for the Israeli settlements, and is not softened to
--     "आवासीय" or sharpened to "अवैध बस्तियाँ";
--   * "Migrant Smuggling" is प्रवासी तस्करी, NOT मानव तस्करी -- the latter is
--     human trafficking, a different offence, and would misdescribe the topic;
--   * non-Indian proper nouns transliterated, not translated (इज़राइल), and
--     established Hindi exonyms used where they exist (पश्चिमी तट, मध्य पूर्व).
--
-- Idempotent and safe to re-run: matches on normalised title, skips anything
-- absent, and ON CONFLICT refreshes the label in place.

insert into public.topic_translations (topic_id, language_code, display_name, review_status)
select t.id, v.language_code, v.display_name, 'machine_generated'
from (values
  ('Government Transparency & Procurement',               'hi', 'सरकारी पारदर्शिता और खरीद'),
  ('Migrant Smuggling Trials',                            'hi', 'प्रवासी तस्करी के मुकदमे'),
  ('Toxic Air Quality Policy',                            'hi', 'विषाक्त वायु गुणवत्ता नीति'),
  ('West Bank Agricultural Impact',                       'hi', 'पश्चिमी तट पर कृषि प्रभाव'),
  ('Agriculture & Food Security — Middle East',           'hi', 'कृषि और खाद्य सुरक्षा — मध्य पूर्व'),
  ('Environmental Policy & Air Quality — Global',         'hi', 'पर्यावरण नीति और वायु गुणवत्ता — वैश्विक'),
  ('Immigration & Border Control — Global',               'hi', 'आप्रवासन और सीमा नियंत्रण — वैश्विक'),
  ('Infrastructure & Public Services — United States',    'hi', 'बुनियादी ढाँचा और सार्वजनिक सेवाएँ — संयुक्त राज्य अमेरिका'),
  ('Infrastructure Development — India',                  'hi', 'बुनियादी ढाँचा विकास — भारत'),
  ('Settlement Policies and Agricultural Impact — Israel','hi', 'बस्ती नीतियाँ और कृषि प्रभाव — इज़राइल'),

  -- Prod's own topics, added when this reached Prod. Its six share no title
  -- with Dev or UAT, which is the third independent confirmation that ids were
  -- never going to carry across environments.
  --
  -- "Infrastructure" is rendered बुनियादी ढाँचा throughout rather than the more
  -- formal अवसंरचना, matching the UAT rows above. Both are standard; mixing them
  -- inside one label set would read as carelessness.
  ('Infrastructure Safety',                               'hi', 'बुनियादी ढाँचा सुरक्षा'),
  ('Infrastructure Safety Accountability',                'hi', 'बुनियादी ढाँचा सुरक्षा जवाबदेही'),
  ('Public Safety Infrastructure',                        'hi', 'सार्वजनिक सुरक्षा का बुनियादी ढाँचा'),
  ('Urban Development & Infrastructure — City',           'hi', 'शहरी विकास और बुनियादी ढाँचा — शहर'),
  ('Digital Infrastructure — United States',              'hi', 'डिजिटल बुनियादी ढाँचा — संयुक्त राज्य अमेरिका'),
  ('Rural Broadband Expansion Policy',                    'hi', 'ग्रामीण ब्रॉडबैंड विस्तार नीति')
) as v(title, language_code, display_name)
join public.topics t
  on lower(btrim(t.title)) = lower(btrim(v.title))
on conflict (topic_id, language_code) do update
  set display_name  = excluded.display_name,
      review_status = excluded.review_status,
      updated_at    = now();
