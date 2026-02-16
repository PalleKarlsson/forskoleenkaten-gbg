-- Migration: Merge schools with identical GPS coordinates that are clearly the same school
-- Each merge: move reports + name variants from duplicate to canonical, then delete duplicate

BEGIN;

-- Helper function for merging schools
CREATE OR REPLACE FUNCTION merge_school(keep_id INT, remove_id INT) RETURNS VOID AS $$
BEGIN
  -- Move reports
  UPDATE pdf_reports SET school_id = keep_id WHERE school_id = remove_id;
  UPDATE pdf_reports SET parent_school_id = keep_id WHERE parent_school_id = remove_id;
  -- Move name variants (skip if area_id+url_slug already exists for keep_id)
  UPDATE school_name_variants SET school_id = keep_id
  WHERE school_id = remove_id
    AND NOT EXISTS (
      SELECT 1 FROM school_name_variants snv2
      WHERE snv2.school_id = keep_id AND snv2.area_id = school_name_variants.area_id AND snv2.url_slug = school_name_variants.url_slug
    );
  DELETE FROM school_name_variants WHERE school_id = remove_id;
  -- Delete school
  DELETE FROM schools WHERE id = remove_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Address-format duplicates: "X förskola" / "Förskolan X" / "Förskola X"
-- Keep the one with most data (listed first)
-- ============================================================

-- Grållekroksvägen 4 / 4-8 (same building)
SELECT merge_school(460, 788);

-- Billdals Kyrkväg 3
SELECT merge_school(420, 7054);

-- Donsö Gärde
SELECT merge_school(7079, 8354);

-- Årekärrsvägen 1
SELECT merge_school(447, 7046);

-- Brännemysten 6
SELECT merge_school(421, 7045);

-- Smithska Vägen 14B
SELECT merge_school(475, 2494);

-- Långlyckevägen 2
SELECT merge_school(7041, 8317);

-- Stomvägen 1
SELECT merge_school(440, 7040);

-- Åkereds Skolväg 20
SELECT merge_school(483, 7066);

-- Opalgatan 100
SELECT merge_school(468, 6221);
SELECT merge_school(468, 7063);

-- Bronsåldersgatan 27
SELECT merge_school(454, 6220);
SELECT merge_school(454, 7062);

-- Tärneskärsgatan 4
SELECT merge_school(808, 6231);
SELECT merge_school(808, 7068);

-- Topasgatan 1
SELECT merge_school(478, 6226);
SELECT merge_school(478, 7071);

-- Skattegårdsvägen 100
SELECT merge_school(437, 6224);
SELECT merge_school(437, 7067);

-- Hammarvägen 4 / 4A
SELECT merge_school(4845, 7060);
SELECT merge_school(4845, 8335);

-- Stenskärsgatan 2
SELECT merge_school(476, 6233);

-- Topasgatan 58
SELECT merge_school(6227, 7072);
SELECT merge_school(6227, 8347);

-- Lilla Grevegårdsvägen 6
SELECT merge_school(431, 7064);

-- Turkosgatan 1
SELECT merge_school(4869, 6225);
SELECT merge_school(4869, 7075);

-- Apelsingatan 15
SELECT merge_school(450, 6219);
SELECT merge_school(450, 7055);

-- Karneolgatan 79
SELECT merge_school(4847, 6217);

-- Nymilsgatan 6-8
SELECT merge_school(467, 7008);

-- Orkestergatan 35
SELECT merge_school(469, 7014);

-- Marklandsgatan 41
SELECT merge_school(464, 7012);

-- Annas Gård 6-8
SELECT merge_school(778, 7009);

-- Sjupundsgatan 8
SELECT merge_school(7010, 8286);

-- Kullegatan 4
SELECT merge_school(853, 6965);

-- Glasmästaregatan 2
SELECT merge_school(118, 6964);

-- Glasmästaregatan 6E
SELECT merge_school(119, 6966);

-- Fridhemsgatan 11A
SELECT merge_school(4759, 6032);

-- Omvägen 2F (merge the one with less means into the one with more)
SELECT merge_school(137, 4933);

-- Rudedammsgatan 6B
SELECT merge_school(140, 5991);
SELECT merge_school(140, 6961);

-- Daniel Petterssons Gata 6
SELECT merge_school(160, 6955);

-- Vasa Kyrkogata 7
SELECT merge_school(201, 6951);

-- Hallandsgatan 7
SELECT merge_school(122, 6953);

-- Prästgårdsgatan 44B
SELECT merge_school(139, 1831);

-- Friggagatan 3B
SELECT merge_school(114, 1612);

-- Äringsgatan 4A (671 has more data)
SELECT merge_school(671, 344);

-- Blåsvädersgatan 2
SELECT merge_school(260, 7117);

-- Höstvädersgatan 51-57
SELECT merge_school(267, 7116);

-- Mildvädersgatan 3
SELECT merge_school(4897, 7105);

-- Höstvädersgatan 73
SELECT merge_school(268, 7115);

-- Dimvädersgatan 1-5 / 1
SELECT merge_school(295, 4345);
SELECT merge_school(295, 7118);

-- Flygvädersgatan 13
SELECT merge_school(296, 7113);

-- Hemmansägaregatan
SELECT merge_school(593, 8400);

-- Författaregatan 11
SELECT merge_school(299, 7163);

-- Runskriftsgatan
SELECT merge_school(4907, 6625);

-- Temperaturgatan 7
SELECT merge_school(316, 7119);

-- Temperaturgatan 70
SELECT merge_school(317, 7106);

-- Temperaturgatan 93
SELECT merge_school(318, 7107);

-- Oxerödsgatan 1
SELECT merge_school(309, 7157);

-- Backa Kyrkogata 7
SELECT merge_school(4803, 7160);

-- Backa Kyrkogata 3
SELECT merge_school(4802, 7159);

-- Krumeluren 6
SELECT merge_school(301, 7156);

-- Rimmaregatan 5
SELECT merge_school(311, 7161);

-- Västra Gunnesgärde 6
SELECT merge_school(4830, 7145);

-- Lisa Sass Gata 11
SELECT merge_school(306, 7155);

-- Tideräkningsgatan 4C
SELECT merge_school(411, 2764);

-- Skogsängsvägen 14
SELECT merge_school(312, 7153);

-- Eriksbo Västergärde 12 / 12-14
SELECT merge_school(355, 8155);

-- Mölnesjögatan 165-166 / 165
SELECT merge_school(400, 4550);

-- Styrmansgatan 21A
SELECT merge_school(193, 2511);

-- Brämaregatan 2D (652 has more data)
SELECT merge_school(652, 325);

-- Gamla Tumlehedsvägen 100-104 / 100
SELECT merge_school(589, 4308);

-- Långströmsgatan 34D / 32-34 (1144 has more data)
SELECT merge_school(1144, 271);

-- Kålhagen 3-7 / 3 / (C)
SELECT merge_school(629, 4352);
SELECT merge_school(629, 6619);

-- Uddevallagatan / 16a
SELECT merge_school(6410, 8223);

-- Plåtslagaregatan
SELECT merge_school(4733, 6265);

-- Teleskopgatan
SELECT merge_school(409, 5957);

-- Nymånen
SELECT merge_school(5520, 6310);

-- Tellusgatan 38
SELECT merge_school(5953, 6911);

-- Kvadrantgatan
SELECT merge_school(5956, 6914);

-- Lilla Holm
SELECT merge_school(5510, 6404);

-- Kometgatan
SELECT merge_school(5949, 6905);

-- Rymden
SELECT merge_school(5112, 1841);

-- ============================================================
-- Name-only duplicates: same school, different name format
-- ============================================================

-- Saltkråkan
SELECT merge_school(216, 1703);
SELECT merge_school(216, 5523);

-- Snipan
SELECT merge_school(226, 2343);
SELECT merge_school(226, 6381);

-- Trädet (1035 has most means: 112)
SELECT merge_school(1035, 1982);
SELECT merge_school(1035, 6335);

-- Johannesgården
SELECT merge_school(4294, 5449);
SELECT merge_school(4294, 6383);

-- Sälen
SELECT merge_school(227, 1865);

-- The English School
SELECT merge_school(253, 6367);

-- Morgonsol (4706 has more data)
SELECT merge_school(4706, 212);

-- Barnens Hus
SELECT merge_school(1897, 5459);

-- Musica
SELECT merge_school(2903, 7206);

-- Polarna (6331 has more data)
SELECT merge_school(6331, 225);

-- Noaks Ark
SELECT merge_school(215, 4296);
SELECT merge_school(215, 6330);

-- Vasa Neon (1037 has most means: 56)
SELECT merge_school(1037, 256);
SELECT merge_school(1037, 6336);

-- Explorama
SELECT merge_school(5437, 5491);

-- Mumin
SELECT merge_school(2596, 6382);

-- Con Brio
SELECT merge_school(1051, 5446);

-- Naturförskolan Solen (2930 has more data)
SELECT merge_school(2930, 247);

-- Murbräckan (213 has more data)
SELECT merge_school(213, 7218);

-- Vildrosen (229 has more data)
SELECT merge_school(229, 2668);

-- Utsikten
SELECT merge_school(5539, 6342);

-- Lyran (6349 has data, 5513 has 0 means)
SELECT merge_school(6349, 5513);

-- Tippen (8786 has more data)
SELECT merge_school(8786, 6343);

-- Franska Skolan (7210 has more data)
SELECT merge_school(7210, 6332);

-- Biet
SELECT merge_school(219, 6351);

-- ABC (7221 has more data)
SELECT merge_school(7221, 5481);

-- Hagabarn
SELECT merge_school(222, 5499);
SELECT merge_school(222, 6345);

-- Tindra (1044 has far more data: 602 means)
SELECT merge_school(1044, 254);

-- Räntmästaregatan (2907 has more data)
SELECT merge_school(2907, 1106);

-- Sankt Pauli (249 has more data)
SELECT merge_school(249, 1959);

-- Hjuviks Fyr (237 has most data)
SELECT merge_school(237, 1085);
SELECT merge_school(237, 5110);

-- Flygledarevägen (1083 has more data)
SELECT merge_school(1083, 208);

-- Sagolunden (1923 has more data)
SELECT merge_school(1923, 1039);

-- Älghagsgatan 4B (6004 has more data)
SELECT merge_school(6004, 5224);

-- Hackspettsgatan
SELECT merge_school(4245, 6424);
SELECT merge_school(4245, 8210);

-- ============================================================
-- Edge cases: same building, merge confirmed
-- ============================================================

-- Melongatan 3 och 90 / Melongatan 3 (same school, renamed; 792 has far more data)
SELECT merge_school(792, 465);

-- Jydeklovan 2 / Brännö förskola (same school on Brännö; 789 has more data)
SELECT merge_school(789, 7076);

-- Kummingatan 132 / Kumminhöjd (Kumminhöjd is the name of school at Kummingatan)
SELECT merge_school(691, 6849);

-- ============================================================
-- Sub-group merges within mixed GPS groups
-- ============================================================

-- Gjutegården 7A group: merge Skeppsskorporna variants + Holmenstyr variants
-- (Gjutegården 425, Skeppsskorporna, Holmenstyr are 3 different schools)
SELECT merge_school(1961, 5453);  -- Skeppsskorporna
SELECT merge_school(5500, 5125);  -- Holmenstyr

-- Fjällstugan / Utbytingen (2 different schools, merge within each)
SELECT merge_school(220, 1908);   -- Fjällstugan
SELECT merge_school(228, 5538);   -- Utbytingen

-- Lekstugan / Snäckskalet (different schools, merge Lekstugan variants only)
SELECT merge_school(241, 2926);   -- Lekstugan

-- Snurran / Balsaminen (different schools, merge Snurran variants only)
SELECT merge_school(5530, 5121);  -- Snurran

-- ============================================================
-- NOT merged (different schools at same location):
-- 455/4839: Bronsåldersgatan 90 vs 82 (different addresses)
-- 474/8344: Smaragdgatan 28 vs 29-30 (different addresses)
-- 377/6918: Aniaragatan 5 vs Introduktionsskolan (different schools)
-- 146/4942/6926: Smörslätten 1 vs Smörslottsgatan 22 (different streets)
-- 4476/4477/5930: Bergsgårdsgärdet 39/54/46-54 (different units)
-- 252/6284/6286/6287: Solgläntan 1/2/3 (different buildings)
-- ============================================================

-- Clean up helper function
DROP FUNCTION merge_school(INT, INT);

COMMIT;
