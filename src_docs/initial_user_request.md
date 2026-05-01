Please, use all your avaliable tools (including mcp tools), to help me research the possibility of creatig a mcp server for accessing the site of National Agency for the Resolution of Appeals from Moldova (by the model of /mnt/nalyk/gits/mcp-mtender/mtender-server/README.md for Moldova Tenders).
---
This new mcp server would have to access
1. Appeals under review: https://www.ansc.md/ro/contestatii/{{year}} (eg: https://www.ansc.md/ro/contestatii/2025)
2. Decisions on appeals: https://www.ansc.md/ro/content/decizii-{{year}} (eg: https://www.ansc.md/ro/content/decizii-2025)
---
On both pages there a forms:
- "#views-exposed-form-contestatii-panel-pane-10" id on both pages, but different search fields, afferent to 2 tables: #myTable table id on both
---
1. Appeals under review
When submiting form, it creates a get request with url like that:
```
https://www.ansc.md/ro/contestatii/2025?AutoritateaContractanta=ac&Contestatar=contestatar&NrProcedurii=%221740472744894%22&solr_document=4 
```
(note both `%22` in `NrProcedurii`)

Where:
`AutoritateaContractanta` is Contracting Authority
`Contestatar` is the Challenger
`NrProcedurii` is the procedure number
`solr_document` is the status, which has following values:
- 1: Withdrawn (Retrasă)  
- 2: Canceled number (Număr anulat)  
- 3: Under review (În examinare)  
- 4: Decision adopted (Decizie adoptată)  
- 5: Withdrawn complaint (Contestație retrasă)  
- 6: Preliminary examination (Examinare preliminară)  
- 7: Awaiting file (În așteptarea dosarului)  
- 8: Returned for correction (Restituită spre corectare)  
- 9: Not within ANSC's competence (Nu ține de competența ANSC)  
- 10: Under review, Procedure suspended (În examinare, Procedură suspendată)  
- 11: Awaiting explanations from the CA (În așteptarea explicațiilor de la AC)  
- 12: Withdrawn complaint – unspecified reason (Contestație retrasă – motiv neprecizat)  
- 13: Withdrawn complaint – to not jeopardize CA's activity (Contestație retrasă – pentru a nu pereclita activitatea AC)  
- 14: Withdrawn complaint – due to exceptional national situation (Contestație retrasă – motivul situației excepționale în țară)  
- 15: Awaiting file / Awaiting explanations from the CA (In așteptarea dosarului/ În așteptarea explicațiilor de la AC)  
- 16: Withdrawn complaint – CA's arguments accepted by the challenger (Contestație retrasă – argumentele AC acceptate de contestator)  
- 17: Withdrawn complaint – deemed unfounded by the challenger (Contestație retrasă – apreciată de contestator ca neîntemeiată)  
- 18: Withdrawn complaint – procedure canceled, complaint rendered irrelevant (Contestație retrasă - procedură anulată, contestație rămasă fără obiect)  
- 19: Withdrawn complaint – remedial measures taken by CA, complaint rendered irrelevant (Contestație retrasă – măsuri de remediere efectuate de către AC, contestație rămasă fără obiect)  

As for search results, they are present in the #myTable <table>, with the following columns (th):
- 1. Complaint Registration Number at ANSC (Nr. Înregistrare contestație la ANSC, eg: "02/279/25")  
- 2. Entry Date (Data intrare, eg: "13/03/2025")  
- 3. Exit Number (Număr de ieșire)  
- 4. Challenger (Contestatar, eg: "S.C. Mobilier Novator SRL")  
- 5. Contracting Authority (Autoritatea Contractantă, eg: "Primăria satului Bursuc")  
- 6. Object of the Complaint (Obiectul Contestației, eg: "Rezultatele procedurii")  
- 7. Procedure Number (Nr. Procedurii, eg: "ocds-b3wdp1-MD-1740472744894", which is a link to https://mtender.gov.md/tenders/ocds-b3wdp1-MD-1740472744894)  
- 8. Procedure Type (Tip procedură)  
- 9. Object of the Procurement (Obiectul Achiziției)  
- 10. Status (Statut)  
- 11. COMPLETE (COMPLET, eg: "COMPLET4" do not know what it is, but we just notuse it for now )  

IMPORTANT: Please, note that `NrProcedurii` (in the get url) and `Nr. Procedurii` in results is in fact OCDS (Open Contracting Data Standard) in the MTender public procurement system of Moldova.

---

2. Decisions on appeals
When submiting form, it creates a get request with url like that:
```
https://www.ansc.md/ro/content/decizii-2025?Contestatar=Contestatar&AutoritateaContractanta=%22Autoritatea+Contractant%22&solr_document=Complet&ObiectulAchizitiei=Obiectul+Achizi%C8%9Biei&solr_document_1=1&solr_document_2=2&solr_document_3%5B%5D=3&solr_document_4=1&solr_document_8=02%2F279%2F25
```
(please, note the encoding, quotes etc)

Where:
`Contestatar` is the Challenger
`AutoritateaContractanta` is Contracting Authority
`solr_document` (leave empty)
`ObiectulAchizitiei` is Object of the Procurement
`solr_document_1` is Status of the Decision (which is a `select multiple="multiple" name="solr_document_3[]"` case), with values:
- 1: In force (În vigoare)  
- 2: Canceled by the court (Anulată de instanța de judecată)  
- 3: Suspended by the court (Suspendată de instanța de judecată)
`solr_document_2` is the Content of Decision, with values:
- 1: Complaint upheld (Contestație admisă)  
- 2: Procedure canceled (Procedură anulată)  
- 3: Procedure partially canceled (Procedură parțial anulată)  
- 4: Remedial measures (Măsuri de remediere)  
- 5: Complaint rejected (Contestație respinsă)  
- 6: Complaint submitted late (Contestație depusă tardiv)  
- 7: Non-compliant/irrelevant complaint (Contestație neconformă/lipsită de obiect)  
- 8: Unfounded complaint (Contestație neîntemeiată)  
- 9: Complaint partially upheld (Contestație parțial admisă)
`solr_document_3` is Criticism/Grounds for Appeal (Critici/Motive de contestare), with values:
- 1: Rejection of the challenger's offer as non-compliant or unacceptable (RP 1 Respingerea ofertei contestatorului ca neconformă sau inacceptabilă)  
- 2: Rejection of the challenger's offer as unacceptable because the bidder does not meet the requirements (RP 1.1 Respingerea ofertei contestatorului ca inacceptabilă, întrucât aceasta a fost depusă de un ofertant care nu îndeplinește)  
- 3: Rejection of the challenger's offer as unacceptable because it exceeds the allocated budget (RP 1.2 Respingerea ofertei contestatorului ca inacceptabilă, întrucât aceasta depășește fondul alocat)  
- 4: Rejection of the challenger's offer as non-compliant because the technical proposal does not meet all requirements/conditions (RP 1.3 Respingerea ofertei contestatorului ca neconformă, întrucât oferta tehnică nu corespunde tuturor cerințelor/condițiilor)  
- 5: Rejection of the challenger's offer because it was not accompanied by the bid guarantee in the required amount, form, and validity period (RP 1.4 Respingerea ofertei contestatorului întrucât aceasta nu a fost însoțită de garanția pentru ofertă, în cuantumul, forma și perioada de valabilitate)  
- 6: Rejection of the challenger's offer as non-compliant due to an abnormally low price (RP 1.5 Respingerea ofertei contestatorului ca neconformă, întrucât acesta are un preț anormal de scăzut)  
- 7: Rejection of the offer without the contracting authority requesting clarifications regarding the technical proposal/price (RP 1.6 Respingerea ofertei fără ca autoritatea contractantă să solicite clarificări referitoare la propunerea tehnică/preţul ofertei)  
- 8: Rejection of the challenger's offer as non-compliant because the bidder did not submit required documents on time (RP 1.7 Respingerea ofertei contestatorului ca neconformă, întrucât ofertantul nu a transmis în perioada precizată de grupul de lucru)  
- 9: Rejection of the challenger's offer as non-compliant because the bidder modified its content through presented responses (RP 1.8 Respingerea ofertei contestatorului ca neconformă, întrucât ofertantul a modificat, prin răspunsurile pe care le-a prezentat)  
- 10: Rejection of the challenger's offer due to changes in the proposal's content through responses (RP 1.9 Respingerea ofertei contestatorului ca neconformă, întrucât ofertantul a modificat, prin răspunsurile pe care le-a prezentat)  
- 11: Scoring/evaluation method of the challenger's offer by the procurement working group (RP 1.10 Modul de punctare/evaluare a ofertei contestatorului de către grupul de lucru pentru achiziții)  
- 12: Rejection of the challenger's offer as inadequate due to irrelevance to the procurement objective (RP 1.11 Respingerea ofertei contestatorului ca neadecvată fiind lipsită de relevanţă faţă de obiectul achiziţiei)  
- 13: Rejection of the challenger's offer due to incorrectly completed forms (RP 1.12 Respingerea ofertei contestatorului pe motivul completării defectuoase a formularelor ofertei)  
- 14: Acceptance of non-compliant or unacceptable offers from other participants by the contracting authority (RP 2 Acceptarea de către autoritatea contractantă a ofertelor altor participanţi neconforme sau inacceptabile)  
- 15: Offers from other participants do not meet one or more qualification requirements (RP 2.1 Ofertele altor participanți nu îndeplinesc una sau mai multe dintre cerințele de calificare)  
- 16: Technical offers from other participants do not meet all conditions in the procurement documentation (RP 2.2 Ofertele tehnice ale altor participanți nu corespund tuturor cerințelor/condițiilor stabilite în documentația de atribuire)  
- 17: Offers from other participants were not accompanied by the required bid guarantee (RP 2.3 Ofertele altor participanți nu au fost însoțite de garanția pentru ofertă, în cuantumul, forma și perioada de valabilitate)  
- 18: Offers from other participants have an abnormally low price (RP 2.4 Ofertele altor participanți au un preț anormal de scăzut)  
- 19: Bidders modified the content of their technical proposal through their responses (RP 2.5 Ofertanții au modificat, prin răspunsurile pe care le-au prezentat, conținutul propunerii tehnice)  
- 20: Bidders modified the content of their financial proposal through their responses (RP 2.6 Ofertanții au modificat, prin răspunsurile pe care le-au prezentat, conținutul propunerii financiare)  
- 21: Scoring/evaluation method of offers from other participants by the procurement working group (RP 2.7 Modul de punctare/evaluare a ofertelor altor participanţi de către grupul de lucru pentru achiziții)  
- 22: Incorrectly completed forms by other participants (RP 2.8 Formularele ofertei completate defectuos de către alți participanți)  
- 23: Lack of information on the procurement procedure results (RP 3 Neinformarea privind rezultatul aplicării procedurii de atribuire)  
- 24: Unjustified cancellation of the procurement procedure (RP 4 Anularea fără temei legal a procedurii de achiziție)  
- 25: Technical errors in SIA RSAP (MTender) (RP 5 Erori tehnice privind SIA RSAP (MTender))  
- 26: Other (RP 6 Altele)  
- 27: Restrictive requirements regarding the candidate’s or bidder’s personal situation (DA 1 Cerinţe restrictive cu privire la situația personală a candidatului sau ofertantului)  
- 28: Restrictive requirements regarding economic/financial qualification criteria (DA 2 Cerinţe restrictive cu privire la criterii de calificare/selecție referitoare la situația economico-financiară)  
- 29: Restrictive requirements regarding cash availability (DA 2.1 Cerințe restrictive cu privire la criterii de calificare/selecție referitoare la disponibilitatea de bani lichizi)  
- 30: Restrictive requirements regarding average turnover (DA 2.2 Cerințe restrictive cu privire la criterii de calificare/selecție referitoare la cifra medie de afaceri)  
- 31: Restrictive requirements regarding technical and/or professional capacity (DA 3 Cerinţe restrictive cu privire la criterii de calificare/selecție referitoare la capacitatea tehnică și/sau profesională)  
- 32: Restrictive requirements regarding similar experience (DA 3.1 Cerinţe restrictive cu privire la criterii de calificare/selecție referitoare la experiența similară)  
- 33: Restrictive requirements regarding quality assurance and environmental standards (DA 4 Cerinţe restrictive cu privire la criterii de calificare/selecție referitoare la standarde de asigurare a calității, de mediu)  
- 34: Restrictive requirements regarding technical specifications (DA 5 Cerinţe restrictive cu privire la specificaţii tehnice)  
- 35: Award criteria: non-transparent or subjective evaluation factors (DA 6 Criterii de atribuire. Factori de evaluare fără algoritm de calcul, cu algoritm de calcul netransparent sau subiectiv)  
- 36: Mentioning specific brands or manufacturers in procurement documents (DA 7 Menţionarea în cadrul documentaţiei de atribuire a unor denumiri de tehnologii, produse, mărci, producători)  
- 37: Lack of clear, complete, and unambiguous responses from the contracting authority (DA 8 Lipsa unui răspuns clar, complet şi fără ambiguităţi din partea autorităţii contractante)  
- 38: Form of bid guarantee (DA 9 Forma de constituire a garanţiei pentru ofertă)  
- 39: Imposing unfair or excessive contract clauses (DA 10 Impunerea de clauze contractuale inechitabile sau excesive)  
- 40: Failure to divide procurement into lots (DA 11 Neîmpărțirea achiziţiei pe loturi)  
- 41: Publication of incomplete procurement documentation (DA 12 Publicarea documentației de atribuire incomplete)  
- 42: Other (DA 12 Altele)  
`solr_document_4` is the Object of the Complaint (Obiectul contestației), with values:
- 1: Award documentation (Documentația de atribuire)  
- 6: Procedure results (Rezultatele procedurii)  
`solr_document_8` is Contestation Number (which is same, by the way, as th1 in `1. Appeals under review` case, earlier)

As for search results, they are present in the #myTable <table>, with the following columns (th):
- 1. Decision Date (Data decizie)  
- 2. Challenger (Contestatar)  
- 3. Contracting Authority (Autoritatea Contractantă)  
- 4. Object of the Complaint (Obiectul Contestației)  
- 5. Decision (Decizia, contains a link like that: https://elo.ansc.md/DownloadDocs/DownloadFileServlet?id=103491, which is a PDF (but has errored ssl, so must ignore certificate))  
- 6. Reported/Unreported Decisions (Decizii Raportat/Neraportat, which can be: empty,`Nu necesită raportare`, `Lipsă de informație`, `Raportat`, but this is not enum, but free text)  

---

When planning our mcp server architecture:
- make sure you do not use pupppetter or something heavy, as you do noy need to
- make sure you check every info i gave (using curl or terminal or any needed or appliable mcp tool) and gather all info you need
- make sure you understand all the why we ar doing, and what we wnat to achieve, in what context


This (/mnt/nalyk/gits/mcp-ansc-server) is a new empty folder, created especially for this mcp server

Here is all starting MCP documentation https://modelcontextprotocol.io/introduction  for refference