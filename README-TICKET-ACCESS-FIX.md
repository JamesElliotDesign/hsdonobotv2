# Private ticket channel access hardening

The `/donate` command now checks the Donator System bot's effective channel permissions before creating a MongoDB order. It requires View Channel, Send Messages, Embed Links and Read Message History.

If Discord rejects the confirmation message after the order is created, the order is automatically marked `cancelled` and an append-only `confirmation_message_post_failed` event is recorded. The payment reference can then be reused.

The permanent fix belongs in the ticket-system bot: add the Donator System bot as a member permission overwrite whenever a private ticket is created.
