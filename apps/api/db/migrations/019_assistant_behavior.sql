CREATE TABLE assistant_behavior (
 owner_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 model_retries integer NOT NULL CHECK (model_retries BETWEEN 0 AND 5),
 system_prompt_append text NOT NULL CHECK (octet_length(system_prompt_append) <= 6000),
 revision integer NOT NULL DEFAULT 1
);

CREATE TABLE assistant_conversation_shares (
 id text PRIMARY KEY,
 conversation_id text NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE UNIQUE,
 document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
