-- One Base44 account now sits behind the whole integration: its personal access
-- token authenticates every platform call, and no shell user has a Base44
-- identity of their own. The per-user link rows (service principal id, minted
-- tokens) have nothing left to describe, and the tokens in them are the kind of
-- thing better gone than kept.
DROP TABLE "base44_links";
DROP TYPE "Base44LinkStatus";
