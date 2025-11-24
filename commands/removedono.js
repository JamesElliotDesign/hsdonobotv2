// commands/removedono.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const Donation = require('../models/Donation');

// Same thresholds as in donate.js
const roles = [
    { id: "1345839570041835591", amount: 1000 },
    { id: "1345840100491395092", amount: 500 },
    { id: "1345839616095289345", amount: 250 },
    { id: "1345838625757204640", amount: 150 },
    { id: "1345836451362766880", amount: 100 },
    { id: "1345834598969643221", amount: 50 },
    { id: "1227025687316005015", amount: 15 }
];

function getRoleForDonation(totalAmount) {
    return roles.find(role => totalAmount >= role.amount) || null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removedono')
        .setDescription('Admins: Remove an amount from a user’s donation total.')
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player to adjust')
                .setRequired(true)
        )
        .addNumberOption(option =>
            option.setName('amount')
                .setDescription('Amount to remove (in £)')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const user = interaction.options.getUser('player');
        const amountToRemove = interaction.options.getNumber('amount');

        if (amountToRemove <= 0) {
            return interaction.reply({
                content: '❌ Amount to remove must be greater than 0.',
                ephemeral: true
            });
        }

        let donation = await Donation.findOne({ discordId: user.id });

        if (!donation || donation.total <= 0) {
            return interaction.reply({
                content: `❌ ${user.username} does not have any recorded donations.`,
                ephemeral: true
            });
        }

        // Adjust total (never below 0)
        donation.total = Math.max(0, donation.total - amountToRemove);

        // Record adjustment in history as negative entry
        donation.history.push({
            amount: -amountToRemove,
            at: new Date(),
            addedBy: interaction.user.id,
            note: 'Manual removal via /removedono'
        });

        await donation.save();

        // Role handling based on NEW total
        const guildMember = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (guildMember) {
            const roleToGive = getRoleForDonation(donation.total);
            const roleIds = roles.map(r => r.id);

            // Remove all donation roles first
            const rolesToRemove = guildMember.roles.cache.filter(r => roleIds.includes(r.id));
            if (rolesToRemove.size > 0) {
                await guildMember.roles.remove(rolesToRemove);
            }

            // Add the appropriate role if there is one
            if (roleToGive) {
                await guildMember.roles.add(roleToGive.id);
            }
        }

        await interaction.reply({
            content: `✅ Removed **£${amountToRemove}** from ${user.username}. Their new total is **£${donation.total}**.`,
            ephemeral: true
        });
    }
};
