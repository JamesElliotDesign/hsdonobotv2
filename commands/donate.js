const {
    SlashCommandBuilder,
    PermissionsBitField,
    MessageFlags,
} = require('discord.js');
const {
    createPendingSupportOrder,
    setConfirmationMessage,
    cancelSupportOrderAfterPostFailure,
} = require('../services/supportOrders');
const { buildPendingSupportMessage } = require('../services/supportMessages');

const REQUIRED_CHANNEL_PERMISSIONS = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.ReadMessageHistory,
];

const PERMISSION_LABELS = new Map([
    [PermissionsBitField.Flags.ViewChannel, 'View Channel'],
    [PermissionsBitField.Flags.SendMessages, 'Send Messages'],
    [PermissionsBitField.Flags.EmbedLinks, 'Embed Links'],
    [PermissionsBitField.Flags.ReadMessageHistory, 'Read Message History'],
]);

async function getMissingChannelPermissions(interaction) {
    if (!interaction.guild || !interaction.channel || !interaction.channel.isTextBased()) {
        return ['a supported server text channel'];
    }

    const botMember = interaction.guild.members.me
        || await interaction.guild.members.fetchMe().catch(() => null);

    if (!botMember) {
        return ['access to the Discord server'];
    }

    const permissions = interaction.channel.permissionsFor(botMember);
    if (!permissions) {
        return REQUIRED_CHANNEL_PERMISSIONS.map(permission => PERMISSION_LABELS.get(permission));
    }

    return REQUIRED_CHANNEL_PERMISSIONS
        .filter(permission => !permissions.has(permission))
        .map(permission => PERMISSION_LABELS.get(permission));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('donate')
        .setDescription('Create a support record for a verified payment.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player receiving the support credit')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('amount')
                .setDescription('Verified amount received in GBP')
                .setMinValue(0.01)
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reference')
                .setDescription('Payment transaction ID or transfer reference')
                .setMinLength(3)
                .setMaxLength(200)
                .setRequired(true)),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let order = null;

        try {
            const missingPermissions = await getMissingChannelPermissions(interaction);
            if (missingPermissions.length) {
                throw new Error(
                    `I cannot post the player confirmation in <#${interaction.channelId}>. ` +
                    `The Donator System bot is missing: **${missingPermissions.join(', ')}**. ` +
                    'No support order was created.'
                );
            }

            const player = interaction.options.getUser('player');
            const playerMember = interaction.options.getMember('player');
            const amount = interaction.options.getNumber('amount');
            const reference = interaction.options.getString('reference');

            order = await createPendingSupportOrder({
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                staffUser: interaction.user,
                playerUser: player,
                playerMember,
                amount,
                paymentReference: reference,
            });

            let confirmationMessage;
            try {
                confirmationMessage = await interaction.channel.send(
                    buildPendingSupportMessage(order)
                );
            } catch (postError) {
                await cancelSupportOrderAfterPostFailure({
                    orderId: order.orderId,
                    staffDiscordId: interaction.user.id,
                    error: postError,
                });

                const wrappedError = new Error(
                    `Discord would not allow me to post in <#${interaction.channelId}>. ` +
                    `Order **${order.orderId}** was cancelled automatically, so the payment reference can be reused. ` +
                    'Check the ticket channel permission overwrite for the Donator System bot.'
                );
                wrappedError.cause = postError;
                throw wrappedError;
            }

            await setConfirmationMessage(order.orderId, confirmationMessage.id);

            await interaction.editReply({
                content:
                    `✅ Created support order **${order.orderId}** for ${player}.\n` +
                    'The payment has not been applied yet. It will be fulfilled when the player clicks **Confirm**.\n' +
                    `You can find this order later with \`/playerinfo player:${player.username}\` or generate evidence with \`/supportreceipt order:${order.orderId}\`.`,
            });
        } catch (error) {
            console.error('❌ Failed to create support order:', error.cause || error);
            await interaction.editReply({
                content: `❌ ${error.message || 'Unable to create the support order.'}`,
            });
        }
    },
};
