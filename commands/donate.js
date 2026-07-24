const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const {
    createPendingSupportOrder,
    setConfirmationMessage,
} = require('../services/supportOrders');
const { buildPendingSupportMessage } = require('../services/supportMessages');

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
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const player = interaction.options.getUser('player');
            const playerMember = interaction.options.getMember('player');
            const amount = interaction.options.getNumber('amount');
            const reference = interaction.options.getString('reference');

            const order = await createPendingSupportOrder({
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                staffUser: interaction.user,
                playerUser: player,
                playerMember,
                amount,
                paymentReference: reference,
            });

            const confirmationMessage = await interaction.channel.send(
                buildPendingSupportMessage(order)
            );

            await setConfirmationMessage(order.orderId, confirmationMessage.id);

            await interaction.editReply({
                content:
                    `✅ Created support order **${order.orderId}** for ${player}.\n` +
                    'The payment has not been applied yet. It will be fulfilled when the player clicks **Confirm**.\n' +
                    `You can find this order later with \`/playerinfo player:${player.username}\` or generate evidence with \`/supportreceipt order:${order.orderId}\`.`,
            });
        } catch (error) {
            console.error('❌ Failed to create support order:', error);
            await interaction.editReply({
                content: `❌ ${error.message || 'Unable to create the support order.'}`,
            });
        }
    },
};
