require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
// Inicializa o cliente com as intents necessárias
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, // Necessário para listar os membros do Role e enviar DMs
    ],
});

client.commands = new Collection();

// Lê os ficheiros da pasta "commands"
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    // Verifica se os comandos exportam as propriedades obrigatórias
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[AVISO] O comando no ficheiro ${filePath} não tem a propriedade "data" ou "execute" obrigatórias.`);
    }
}

// Evento quando o bot estiver online
client.once('clientReady', () => {
    console.log(`O NAIPE está online e a dar cartas!♠️  Logado como ${client.user.tag} ♦️`);
});

// Lê os ficheiros da pasta "events"
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);

    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}

// Faz login usando o token do .env
client.login(process.env.DISCORD_TOKEN);
