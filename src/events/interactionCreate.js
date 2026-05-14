const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

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

        // 1. Lógica do menu de seleção (Painel)
        if (interaction.isUserSelectMenu() && interaction.customId === 'select_candidato') {
            if (votacaoAtiva) return interaction.reply({ content: 'Já existe uma votação a decorrer!', ephemeral: true });

            candidatoId = interaction.values[0];
            votacaoAtiva = true;
            votosSim = 0;
            votosNao = 0;
            quemJaVotou.clear();

            const embedVotacao = new EmbedBuilder()
                .setTitle('⚖️・Votação a decorrer!')
                .setDescription(`### O <@${candidatoId}> foi proposto para entrar na premade.\n・Os votos são feitos no DM com o BOT\n・Os votos são 100% anónimos.\n・Vota Sim ou Não sem medos`)
                .setColor('#313137');

            const botoesDM = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_sim').setLabel('✅ Sou a Favor').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_nao').setLabel('❌ Sou Contra').setStyle(ButtonStyle.Danger)
            );

            const embedDM = new EmbedBuilder()
                .setTitle('⚖️・Votação a decorrer!')
                .setDescription(`### O <@${candidatoId}> foi proposto para entrar na premade.\n・Os votos são **100%** anónimos.\n・Vota **a Favor** ou **Contra** sem medos\n・São precisos **70% de votos** para a pessoa entrar na premade.`)
                .setColor('#313137');

            await interaction.update({ embeds: [embedVotacao], components: [] });
            mensagemVotacao = interaction.message;

            try {
                // Previne eventuais rate limits de fetches seguidos
                await interaction.guild.members.fetch();
                const role = interaction.guild.roles.cache.get(ROLE_PREMADE_ID);
                if (role) {
                    role.members.forEach(async (membro) => {
                        if (!membro.user.bot) {
                            try {
                                await membro.send({
                                    embeds: [embedDM],
                                    components: [botoesDM]
                                });
                            } catch (e) { }
                        }
                    });
                }
            } catch (e) {
                console.error("Erro ao buscar membros no modal:", e);
            }
            return;
        }

        // 3. Lógica dos botões de votar na DM
        if (interaction.isButton() && (interaction.customId === 'btn_sim' || interaction.customId === 'btn_nao')) {
            if (!votacaoAtiva) return interaction.reply({ content: 'Esta votação já terminou.', ephemeral: true });

            // O botão foi carregado na DM, logo interaction.guild é null.
            // Precisamos do guild para verificar o cargo e para contar os votos.
            const guild = interaction.guild || mensagemVotacao.guild;

            const member = await guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !member.roles.cache.has(ROLE_PREMADE_ID)) {
                return interaction.reply({ content: 'Só quem está na premade pode votar.', ephemeral: true });
            }

            if (quemJaVotou.has(interaction.user.id)) return interaction.reply({ content: 'Já votaste nesta pessoa! Não tentes aldrabar.', ephemeral: true });

            quemJaVotou.add(interaction.user.id);
            if (interaction.customId === 'btn_sim') votosSim++;
            if (interaction.customId === 'btn_nao') votosNao++;

            // Na DM usamos update para limpar os botões para o user perceber que votou
            if (!interaction.guild) {
                await interaction.update({ content: '✅ O teu voto anónimo foi registado com sucesso.', components: [] });
            } else {
                await interaction.reply({ content: '✅ O teu voto anónimo foi registado com sucesso.', ephemeral: true });
            }

            try {
                const rolePremade = guild.roles.cache.get(ROLE_PREMADE_ID);
                if (!rolePremade) return;

                const totalVotantes = rolePremade.members.filter(m => !m.user.bot).size;
                const votosTotais = votosSim + votosNao;

                console.log(`\n--- STATUS DA VOTAÇÃO ---`);
                console.log(`Votos Sim: ${votosSim} | Votos Não: ${votosNao} | Total Votantes: ${totalVotantes} | Registados: ${votosTotais}`);

                if (votosTotais >= totalVotantes) encerrarVotacao(guild);
            } catch (e) {
                console.error("Erro a contabilizar votos:", e);
            }
            return;
        }

        // 4. Execução normal dos slash commands (NÃO APAGAR ESTA PARTE)
        if (interaction.isChatInputCommand()) {
            
            // Apanhar o comando /ffv localmente para ter acesso ao estado
            if (interaction.commandName === 'ffv') {
                if (interaction.user.id !== TEU_ID_ADMIN) return interaction.reply({ content: 'Só o admin pode forçar o fim da votação!', ephemeral: true });
                if (!votacaoAtiva) return interaction.reply({ content: 'Não há nenhuma votação ativa para terminar.', ephemeral: true });
                
                await interaction.reply({ content: 'Forçaste o fim da votação.', ephemeral: true });
                const guild = interaction.guild || (mensagemVotacao ? mensagemVotacao.guild : null);
                if (guild) return encerrarVotacao(guild);
                return;
            }

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
