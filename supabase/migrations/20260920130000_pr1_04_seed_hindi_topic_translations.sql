-- PR 1.5 (cont.) — seed Hindi topic labels for every topic in use.
--
-- Decision recorded: these are machine-generated and ship WITHOUT native-speaker
-- review, at the product owner's explicit direction after the tradeoff was put
-- to them. `review_status` exists so that stays visible and a later human pass
-- can correct rows in place without regenerating anything.
--
-- Translation choices lean deliberately toward the neutral register, because a
-- topic label frames every question inside it:
--
--   Caste Reservation Policy   -> जाति आधारित आरक्षण नीति   (आरक्षण, never कोटा —
--                                 कोटा carries a pejorative charge in Indian
--                                 political discourse)
--   Assam-Bangladesh Border    -> असम-बांग्लादेश सीमा मुद्दे  (सीमा मुद्दे, never
--                                 घुसपैठ, which asserts a political position)
--   SC/ST Act Enforcement      -> अनुसूचित जाति/जनजाति अधिनियम प्रवर्तन
--
-- Where the ENGLISH source already carries a framing ("Pakistan-Backed
-- Militancy"), the Hindi mirrors it rather than softening or sharpening it.
-- Re-framing during translation would be the platform editorialising, which is
-- the opposite of the intended neutrality; if the English label is wrong, fix
-- the English label.
--
-- Organisation names use their standard Hindi forms (भाजपा, कांग्रेस, आरएसएस);
-- non-Indian proper nouns are transliterated, not translated.
--
-- Idempotent: ON CONFLICT updates display_name, so re-running after a review
-- pass is safe.

alter table public.topic_translations
  add column if not exists review_status text not null default 'machine_generated';

comment on column public.topic_translations.review_status is
  'machine_generated | human_reviewed. Rows seeded by PR 1.5 are machine_generated and have had no native-speaker review — a deliberate, recorded product decision. Flip to human_reviewed when someone Hindi-fluent has checked the row.';

insert into public.topic_translations (topic_id, language_code, display_name, review_status)
select v.topic_id::uuid, v.language_code, v.display_name, v.review_status
from (values
 ('cf5d445d-28a8-4ddf-af3a-5fa4dbc0d82d','hi','गर्भपात और स्वास्थ्य सेवा जवाबदेही','machine_generated'),
 ('c1df5575-b19b-407b-985e-87a254470bfe','hi','एआई साक्षरता और शिक्षा','machine_generated'),
 ('fc7873ce-a575-4a57-a7e9-85bee466d0e3','hi','आंध्र प्रदेश शिक्षा नीति','machine_generated'),
 ('0deb0e0c-16ce-47b8-b595-4d7b72a534bb','hi','असम-बांग्लादेश सीमा मुद्दे','machine_generated'),
 ('02ab1953-d059-4ae8-a497-f44f6a68030f','hi','बांग्लादेश-भारत राजनयिक संबंध','machine_generated'),
 ('18f874cf-dd03-4372-b486-5e54bd8a9bcf','hi','बांग्लादेश-भारत राजनयिक संबंध','machine_generated'),
 ('91094791-7c3e-4aca-839d-d79caf70171d','hi','बार काउंसिल नेतृत्व विवाद','machine_generated'),
 ('3e33b2f2-7592-4eef-b009-384bc000599f','hi','बिहार राजनीतिक घटनाक्रम','machine_generated'),
 ('227fd84c-a6c7-4ebf-b446-37c96dc7ac8b','hi','बायोमेट्रिक निगरानी नीति','machine_generated'),
 ('6b2eae94-6dfe-4dda-9de4-84e9114f89c5','hi','भाजपा नेतृत्व परिवर्तन','machine_generated'),
 ('ee270506-6d00-4879-b7d3-d1d49a7ca857','hi','भाजपा नेतृत्व हस्तांतरण','machine_generated'),
 ('84f84e62-aaf5-44c0-ba7c-25137c50fd3a','hi','भाजपा संगठनात्मक ढांचा','machine_generated'),
 ('20a13004-c30c-4b01-9244-122866ea8cbe','hi','भाजपा-कांग्रेस राजनीतिक टकराव','machine_generated'),
 ('8cd20b51-7fd1-4adb-ad52-90f06e7ae12a','hi','कनाडा-अमेरिका व्यापार संबंध','machine_generated'),
 ('83cf81f7-aaf0-445a-87a1-8137196027b2','hi','जाति आधारित आरक्षण नीति','machine_generated'),
 ('4c1501a9-a8dc-48e3-9336-6142213d4b20','hi','प्रसिद्ध हस्तियों का निधन','machine_generated'),
 ('8fc1f2b4-8ab1-4116-9206-7e2a18bc098e','hi','जनगणना और जाति पर बहस','machine_generated'),
 ('bf1dbeb2-044d-4716-94c5-b37b3c2b322b','hi','चेन्नई हवाई अड्डा विकास','machine_generated'),
 ('30b21dd4-d026-40da-a611-68ff9ea65b77','hi','बाल कल्याण और सुरक्षा','machine_generated'),
 ('c141c1c2-0024-408d-b6a8-21f761be9cef','hi','अमेरिकी कांग्रेस बजट वार्ता','machine_generated'),
 ('d12326a5-af7f-4341-b206-e1567a7e004d','hi','भ्रष्टाचार जांच','machine_generated'),
 ('893054db-aabc-41b9-9236-24e976c0c07c','hi','डेटा सेंटर विनियमन पर बहस','machine_generated'),
 ('1bdc6fb0-a212-4ee4-b320-1fc84826055e','hi','दिल्ली सीएनजी मूल्य नीति','machine_generated'),
 ('6b5b725b-23c8-4fc0-b5d9-768014089ec8','hi','लोकतंत्र और असहमति','machine_generated'),
 ('a214c768-a89b-413f-9b14-95da0412c073','hi','डॉली पार्टन का सांस्कृतिक प्रभाव','machine_generated'),
 ('f71fb632-41c4-41bf-ba3e-137f499b7e3c','hi','घरेलू हिंसा जांच','machine_generated'),
 ('5fc324de-3cf8-4b20-b305-4e8c07139268','hi','दहेज हिंसा और लैंगिक न्याय','machine_generated'),
 ('481a8433-fa77-4d7e-9439-cd16d20d387c','hi','दहेज हिंसा और सुधार','machine_generated'),
 ('40132564-4ca5-4c07-b694-c976ce261f44','hi','इबोला टीका विकास','machine_generated'),
 ('f209b716-1069-44a6-b6e5-6898d81bd0b9','hi','शिक्षा वित्तपोषण नीति','machine_generated'),
 ('abec2ac8-ba73-4d4f-b927-248446f121fd','hi','पर्यावरण प्रदूषण और सफाई','machine_generated'),
 ('9dc100bf-6b96-4b7b-99bf-782fcdd80ea6','hi','एफबीआई भर्ती मानक','machine_generated'),
 ('43203c24-eec9-400a-b890-349c51cc7468','hi','फेडरल रिज़र्व मौद्रिक नीति','machine_generated'),
 ('b3cad0af-ea24-4344-976a-9cb820191dd7','hi','फीफा-यूईएफए संबंध','machine_generated'),
 ('79c484f2-19d0-445b-b9f0-b3d6e32ab6ae','hi','खाद्य सुरक्षा पहल','machine_generated'),
 ('1862c108-dc83-4a12-bc98-d5790aebe093','hi','विदेश नीति की आलोचना','machine_generated'),
 ('111ed9e2-13be-4743-83b2-63fb4b5d53c8','hi','गांधी स्मृति-वस्तु नीलामी','machine_generated'),
 ('1ec6d545-1fab-436b-a0c1-605e17f0b70d','hi','वैश्विक वित्तीय बाज़ार','machine_generated'),
 ('8aadedc3-9fec-4202-a85e-6c4a3d94b43e','hi','सोने की कीमत का रुझान','machine_generated'),
 ('184a5495-1792-4f58-b3cc-cd64e7ba9f38','hi','हैती में गिरोह हिंसा','machine_generated'),
 ('f9c1fc22-5e85-4e43-96ae-bc5d67b6b3d1','hi','स्वास्थ्य सेवा जवाबदेही','machine_generated'),
 ('0304ec33-94cd-448a-9ec4-605ea92dc285','hi','हत्या की जांच','machine_generated'),
 ('345ea18d-6703-4eb8-8dfb-021c9f4f22ab','hi','अस्पताल सुरक्षा मानक','machine_generated'),
 ('73308959-d6a6-480f-a59a-f44013583f6b','hi','आव्रजन प्रवर्तन नीति','machine_generated'),
 ('30d8811b-f1a4-4988-8c06-923c2aef59c4','hi','इमरान खान से जुड़े कानूनी मामले','machine_generated'),
 ('b4174271-608d-4e04-b06c-5c3cc7d4b04a','hi','भारत आर्थिक बहस','machine_generated'),
 ('53e9c5d7-92fd-4f8c-b192-3966688d0eca','hi','भारत अवसंरचना सुरक्षा','machine_generated'),
 ('f552de86-dae6-48d6-ade3-c5aa53b9ebc2','hi','भारत में राजनीतिक विमर्श','machine_generated'),
 ('f6b19c02-57ac-4600-a005-1d133d17d72c','hi','भारत में क्षेत्रीय निवेश असमानता','machine_generated'),
 ('3ce2571b-d3fd-475a-92fe-162ad8565447','hi','भारत में क्षेत्रीय निवेश समता','machine_generated'),
 ('3990184f-ea3b-4487-846a-45047e57771c','hi','भारत क्षेत्रीय निवेश नीति','machine_generated'),
 ('2951f339-116d-4b54-9769-0d4a98851f85','hi','भारत नियामकीय शासन','machine_generated'),
 ('ac3408e3-a962-40bf-b310-162d9f8b7730','hi','भारत खुदरा मुद्रास्फीति रुझान','machine_generated'),
 ('02ed3dc3-5eb9-4034-9783-8259ef526aac','hi','भारत में छात्र रोज़गार-योग्यता','machine_generated'),
 ('4cee7218-aecd-4bb2-a2ac-c5e409a7300f','hi','भारत-जापान आर्थिक संबंध','machine_generated'),
 ('88ac77df-2479-4731-80c6-55b7c9f3e30d','hi','भारत-पाकिस्तान राजनयिक संबंध','machine_generated'),
 ('ce8da884-68b0-499f-8378-ddd6ac74518f','hi','भारत-अमेरिका ऊर्जा प्रतिबंध','machine_generated'),
 ('08aa77ce-d17a-44e9-a08d-9a428c5e73c5','hi','भारत-अमेरिका व्यापार संबंध','machine_generated'),
 ('fe227986-a439-498a-afd9-95ca3d0bac42','hi','भारतीय छात्रों का विदेश प्रवास','machine_generated'),
 ('969a9378-13eb-48c5-b8e9-6d8b44d01a3c','hi','भारतीय युवा भागीदारी नीति','machine_generated'),
 ('2d820d04-735b-4623-8f5d-cabc543a6908','hi','ईरान-ब्रिक्स संबंध','machine_generated'),
 ('6cdd2ea3-9502-4526-94a0-4a828a5502af','hi','ईरान-अमेरिका समुद्री संबंध','machine_generated'),
 ('4f5b66ed-df07-4bb2-8749-c3d918fab9fb','hi','इज़राइल-फ़िलिस्तीन पर जनमत','machine_generated'),
 ('6a73acdd-9402-43eb-95ea-1b9f190cb5fc','hi','जयपुर विद्यालय अवसंरचना समस्याएँ','machine_generated'),
 ('553c4a91-a3a2-439f-8527-9d8b741e02e0','hi','झारखंड शिक्षा नीति','machine_generated'),
 ('2a97f9d7-9dcb-4b9c-9156-2e74478fc3a4','hi','झारखंड छात्र प्रदर्शन','machine_generated'),
 ('d1c1cab8-2753-4f2b-b2b4-ee0b6e7424c1','hi','धोखाधड़ी योजनाओं पर न्यायपालिका की प्रतिक्रिया','machine_generated'),
 ('8f2c6b8e-c055-4233-a783-7ac30742a030','hi','विधि पेशे की सत्यनिष्ठा','machine_generated'),
 ('c0174488-bdd8-4eb7-b44a-c234256beebb','hi','मध्य प्रदेश भ्रष्टाचार प्रकरण','machine_generated'),
 ('1d8bb7d2-a175-4fb3-9280-194023f5162e','hi','मेलनगेट विवाद','machine_generated'),
 ('e0d4bfb3-eab2-47ef-bcbf-251e4e139a75','hi','मोटरस्पोर्ट आयोजन','machine_generated'),
 ('3d58ff91-9856-4933-816a-88fd6e6a2615','hi','मुंबई क्रेन दुर्घटना','machine_generated'),
 ('3a714304-39ad-4dc9-8ab1-c97cb9379582','hi','राष्ट्रगान विवाद','machine_generated'),
 ('2eacdcda-7720-4ab1-bec9-111b1c0295b4','hi','नीट प्रदर्शन और राजनीतिक बहस','machine_generated'),
 ('cf0346dc-465e-445c-8400-192cb0499c46','hi','नेपाल आपदा प्रतिक्रिया','machine_generated'),
 ('35fcea4a-15d2-4117-aded-2fe980958064','hi','नेपाल बाढ़ प्रतिक्रिया','machine_generated'),
 ('9785f050-c286-4253-86c0-3caf43a10ee1','hi','पाकिस्तान समर्थित उग्रवाद','machine_generated'),
 ('4e40c30b-9ea6-4091-8976-6c50a7b40da1','hi','पाकिस्तान-अमेरिका राजनयिक संबंध','machine_generated'),
 ('d74636a5-d179-49a3-9db0-b96737c6c324','hi','राजनीतिक जवाबदेही और मीडिया स्वतंत्रता','machine_generated'),
 ('186911f4-331b-4ae9-88c0-aec4468917be','hi','भारत में राजनीतिक जवाबदेही','machine_generated'),
 ('037fb4a8-49df-41f3-8eab-39f5916fb1ef','hi','भारत में राजनीतिक जवाबदेही','machine_generated'),
 ('74052311-c0ad-4743-9a4a-bfaa0f902eca','hi','भारत में राजनीतिक जवाबदेही','machine_generated'),
 ('f2aa526c-b5c6-4517-9042-5869bd3ac8e1','hi','राजनीतिक अभियान रणनीतियाँ','machine_generated'),
 ('73cf08e5-504c-4c2a-9420-1616cb9a4ea5','hi','भारत में राजनीतिक विवाद','machine_generated'),
 ('805ff68a-7f03-4914-84c4-351c2967a9c4','hi','राजनीतिक छवि और सोशल मीडिया','machine_generated'),
 ('371d6be9-e908-4597-86b1-01fda5fbf8ab','hi','भारत में राजनीतिक आंतरिक कलह','machine_generated'),
 ('293ef23f-77e5-41b3-b4ef-1fbf57b2eb08','hi','भारत में राजनीतिक बयानबाज़ी','machine_generated'),
 ('b6e3f6c4-c5de-4849-99bf-b1c0b260642c','hi','प्राथमिक शिक्षा भाषा नीति','machine_generated'),
 ('4a9a4e17-c7d4-4ed9-9f66-7f9aa336caa7','hi','राम मंदिर प्रबंधन','machine_generated'),
 ('c96dbf5e-1ded-47e4-b1ee-4f4f522036bd','hi','सड़क सुरक्षा और नागरिक अनुपालन','machine_generated'),
 ('08a067fe-16c3-4d99-b01c-ed006df6223d','hi','रोबोटिक्स और खेल प्रदर्शन','machine_generated'),
 ('574ee3c1-df02-4eda-8563-25f00086f8bf','hi','आरएसएस नेतृत्व और प्रभाव','machine_generated'),
 ('5110961d-ad84-425f-a8bd-ef968b37c638','hi','ग्रामीण इंटरनेट पहुँच','machine_generated'),
 ('d0f93772-a921-4eb0-8163-7f0618849e0d','hi','रूस-जर्मनी हथियार संबंधी चिंताएँ','machine_generated'),
 ('fc9732fb-2a9b-4287-a4a2-05c6da1fb184','hi','रूस-भारत राजनयिक संबंध','machine_generated'),
 ('418dc983-93e0-4327-b3f0-853f9e6d6103','hi','अनुसूचित जाति/जनजाति अधिनियम प्रवर्तन','machine_generated'),
 ('f713ce67-a98e-45c7-93e9-672fa5ddd58c','hi','दक्षिण भारत की आर्थिक वृद्धि','machine_generated'),
 ('661963a1-0d64-44ae-9b12-7611cda90be2','hi','चीनी मूल्य विनियमन','machine_generated'),
 ('a0225fc5-f634-4395-87a8-7e71b3a0049e','hi','आत्महत्या के लिए उकसाने का मामला','machine_generated'),
 ('61fac8fc-c762-4943-b751-3f10c85d2d52','hi','टिकाऊ आवास पहल','machine_generated'),
 ('28ac9a8d-141f-4696-9a70-1d41e4c49c74','hi','तमिलनाडु विधानसभा प्रक्रियाएँ','machine_generated'),
 ('20b94839-b65c-4771-a9e2-7190dbad96ab','hi','शुल्क नीति','machine_generated'),
 ('7221be4d-ef6f-40f2-b44c-8d89f6effdbd','hi','आतंकवाद और सुरक्षा मुद्दे','machine_generated'),
 ('0ca00bfa-784a-4341-85a2-64fc16119b49','hi','व्यापार संबंध','machine_generated'),
 ('c316cf42-c57e-4748-8dd1-aa2f71ac0122','hi','ट्रंप की मध्यावधि रणनीति','machine_generated'),
 ('f0e074da-7128-46f3-ac72-c996b1ea8489','hi','यूक्रेन-रूस संघर्ष','machine_generated'),
 ('9cc8b772-3ddc-401b-9dbe-cc148ba62885','hi','शहरी बेरोज़गारी रुझान','machine_generated'),
 ('38d82bc5-dba1-43e4-88ed-5a3e60a78baa','hi','अमेरिकी आर्थिक स्थिरता','machine_generated'),
 ('7a4c5abd-1d2d-4195-9f4d-fc77cf3a73a0','hi','एशिया में अमेरिकी विदेश नीति','machine_generated'),
 ('dac714d5-89a2-44c2-9b6a-61a8a5671341','hi','अमेरिकी एच1बी वीज़ा नीति','machine_generated'),
 ('de7620ed-edd3-4a68-9eed-14d6e1c483a5','hi','अमेरिका-ईरान आर्थिक प्रतिबंध','machine_generated'),
 ('2b5bbad8-0fbc-4d5a-a691-475a8a3a6edb','hi','टीकाकरण नीति','machine_generated'),
 ('c68c472a-109a-458c-bd7e-4a7ba71ee439','hi','विकसित भारत पहल','machine_generated'),
 ('c561d5fd-b18b-44d9-b01a-27ec736c04a6','hi','वन्यजीव अवैध शिकार के मुद्दे','machine_generated'),
 ('367ce3dc-8e00-4ca3-a0c6-42b5c2feceba','hi','महिला आरक्षण नीति','machine_generated')
) as v(topic_id, language_code, display_name, review_status)
-- PROMOTION SAFETY (added when this reached UAT).
--
-- These ids are DEV's topics. topic_translations.topic_id is FK-constrained to
-- topics(id), so on any other environment this insert aborts the entire
-- migration with a foreign-key violation -- UAT and Prod generate their own
-- topics from their own ingest, and UAT shares ZERO topic titles with Dev.
--
-- Filtering to ids that actually exist makes the migration a no-op wherever
-- those topics are absent, instead of a hard failure. It changes nothing on
-- Dev, where every id resolves. Seeding for other environments is pr1_04b,
-- which keys on TITLE rather than id for exactly this reason.
where exists (select 1 from public.topics t where t.id = v.topic_id::uuid)
on conflict (topic_id, language_code) do update
  set display_name  = excluded.display_name,
      review_status = excluded.review_status,
      updated_at    = now();
