require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`A iniciar a atualização de ${commands.length} comandos slash (/).`);

        let data;
        // Se a variável GUILD_ID estiver presente, os comandos serão atualizados instantaneamente nesse servidor
        // Caso contrário, são atualizados globalmente (pode demorar algum tempo a propagar no Discord)
        if (process.env.GUILD_ID) {
            data = await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands },
            );
            console.log(`Foram recarregados com sucesso ${data.length} comandos slash no servidor específico.`);
        } else {
            data = await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands },
            );
            console.log(`Foram recarregados com sucesso ${data.length} comandos slash globais.`);
        }
    } catch (error) {
        console.error(error);
    }
})();
