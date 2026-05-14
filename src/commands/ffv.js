const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ffv')
        .setDescription('Comando para admins: Forçar o fim da votação ativa.'),
    async execute(interaction) {
        // A lógica real está a ser apanhada no interactionCreate.js por causa do estado da votação!
        // Isto apenas serve para registar o comando no Discord.
    },
};
