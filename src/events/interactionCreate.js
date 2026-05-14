const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');

// Variáveis globais para esta votação única
let votacaoAtiva = false;
let candidatoId = null;
let votosSim = 0;
let votosNao = 0;
let quemJaVotou = new Set();
let mensagemVotacao = null;

const ROLE_PREMADE_ID = '1504240255296081920';
const TEU_ID_ADMIN = '408738678492364801';

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {

        // 1. Lógica do botão inicial (Painel)
        if (interaction.isButton() && interaction.customId === 'btn_propor') {
            if (votacaoAtiva) return interaction.reply({ content: 'Já existe uma votação a decorrer!', ephemeral: true });

            const modal = new ModalBuilder().setCustomId('modal_propor').setTitle('Adicionar à Premade');
            const inputId = new TextInputBuilder().setCustomId('input_candidato_id').setLabel('Qual é o ID do Discord do candidato?').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(inputId));
            await interaction.showModal(modal);
            return;
        }

        // 2. Lógica de Submissão do Modal
        if (interaction.isModalSubmit() && interaction.customId === 'modal_propor') {
            candidatoId = interaction.fields.getTextInputValue('input_candidato_id');
            votacaoAtiva = true;
            votosSim = 0;
            votosNao = 0;
            quemJaVotou.clear();

            const embedVotacao = new EmbedBuilder()
                .setTitle('⚖️ Nova Votação de Entrada!')
                .setDescription(`Alguém propôs o membro <@${candidatoId}> para entrar na premade.\nOs votos são 100% anónimos.`)
                .setColor('Blue');

            const botoes = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_sim').setLabel('Aprovar (Sim)').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_nao').setLabel('Rejeitar (Não)').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('btn_forcar_fim').setLabel('Admin: Forçar Fim').setStyle(ButtonStyle.Secondary)
            );

            await interaction.reply({ embeds: [embedVotacao], components: [botoes] });
            mensagemVotacao = await interaction.fetchReply();

            try {
                // Previne eventuais rate limits de fetches seguidos
                await interaction.guild.members.fetch();
                const role = interaction.guild.roles.cache.get(ROLE_PREMADE_ID);
                if (role) {
                    role.members.forEach(async (membro) => {
                        if (!membro.user.bot) {
                            try { await membro.send(`Alô Malta, temos votação a decorrer para o <@${candidatoId}> entrar na premade.`); } catch (e) { }
                        }
                    });
                }
            } catch (e) {
                console.error("Erro ao buscar membros no modal:", e);
            }
            return;
        }

        // 3. Lógica dos botões de votar e forçar fim
        if (interaction.isButton() && (interaction.customId === 'btn_sim' || interaction.customId === 'btn_nao' || interaction.customId === 'btn_forcar_fim')) {
            if (!votacaoAtiva) return interaction.reply({ content: 'Esta votação já terminou.', ephemeral: true });

            if (interaction.customId === 'btn_forcar_fim') {
                if (interaction.user.id !== TEU_ID_ADMIN) return interaction.reply({ content: 'Só o admin pode forçar o fim da votação!', ephemeral: true });
                await interaction.reply({ content: 'Forçaste o fim da votação.', ephemeral: true });
                return encerrarVotacao(interaction.guild);
            }

            if (!interaction.member.roles.cache.has(ROLE_PREMADE_ID)) return interaction.reply({ content: 'Só quem já está na premade pode votar.', ephemeral: true });
            if (quemJaVotou.has(interaction.user.id)) return interaction.reply({ content: 'Já votaste nesta pessoa! Não tentes aldrabar.', ephemeral: true });

            quemJaVotou.add(interaction.user.id);
            if (interaction.customId === 'btn_sim') votosSim++;
            if (interaction.customId === 'btn_nao') votosNao++;

            await interaction.reply({ content: '✅ O teu voto anónimo foi registado com sucesso.', ephemeral: true });

            try {
                const rolePremade = interaction.guild.roles.cache.get(ROLE_PREMADE_ID);
                if (!rolePremade) return;

                const totalVotantes = rolePremade.members.filter(m => !m.user.bot).size;
                const votosTotais = votosSim + votosNao;

                console.log(`\n--- STATUS DA VOTAÇÃO ---`);
                console.log(`Votos Sim: ${votosSim} | Votos Não: ${votosNao} | Total Votantes: ${totalVotantes} | Registados: ${votosTotais}`);

                if (votosTotais >= totalVotantes) encerrarVotacao(interaction.guild);
            } catch (e) {
                console.error("Erro a contabilizar votos:", e);
            }
            return;
        }

        // 4. Execução normal dos slash commands (NÃO APAGAR ESTA PARTE)
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) {
                console.error(`Nenhum comando com o nome ${interaction.commandName} foi encontrado.`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'Ocorreu um erro ao executar este comando!', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'Ocorreu um erro ao executar este comando!', ephemeral: true });
                }
            }
        }
    }
};

async function encerrarVotacao(guild) {
    votacaoAtiva = false;
    const votosTotais = votosSim + votosNao;
    const percentagem = votosTotais === 0 ? 0 : (votosSim / votosTotais) * 100;
    const aprovado = percentagem >= 65;

    const embedFinal = new EmbedBuilder()
        .setTitle(aprovado ? '✅ Candidato Aprovado!' : '❌ Candidato Rejeitado!')
        .setDescription(`A votação para o <@${candidatoId}> terminou.\nObteve **${percentagem.toFixed(1)}%** (precisava de 65%).\n\nSim: ${votosSim}\nNão: ${votosNao}`)
        .setColor(aprovado ? 'Green' : 'Red');

    if (mensagemVotacao) {
        try {
            await mensagemVotacao.edit({ embeds: [embedFinal], components: [] });
        } catch (e) {
            console.error("Não foi possível editar a mensagem da votação:", e);
        }
    }

    if (aprovado) {
        try {
            const membroCandidato = await guild.members.fetch(candidatoId);
            if (membroCandidato) await membroCandidato.roles.add(ROLE_PREMADE_ID);
        } catch (error) {
            console.log("Erro a dar cargo ao membro aprovado:", error);
        }
    }
}
