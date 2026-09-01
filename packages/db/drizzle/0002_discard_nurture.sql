UPDATE "allocation_cards"
SET "stage" = 'passed', "nurture_follow_up_at" = NULL
WHERE "stage" = 'nurture';
