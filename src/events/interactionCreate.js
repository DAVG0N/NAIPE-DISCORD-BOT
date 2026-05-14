const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder } = require('discord.js');

// Variáveis globais para esta votação única
let votacaoAtiva = false;
let candidatoId = null;
let votosSim = 0;
let votosNao = 0;
let quemJaVotou = new Set();
let mensagemVotacao = null;

const ROLE_PREMADE_ID = '1504240255296081920';
const TEU_ID_ADMIN = '408738678492364801';
const CANAL_BOAS_VINDAS_ID = '1504558308474884167'; // <-- COLOCA AQUI O ID DO TEU CANAL DE ENTRADAS

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

            const votoTexto = interaction.customId === 'btn_sim' ? 'a Favor' : 'Contra';

            // Na DM usamos update para limpar os botões e mostrar o resumo do voto
            if (!interaction.guild) {
                const embedVotoRegistado = new EmbedBuilder()
                    .setTitle('🗳️・Voto Registado')
                    .setDescription(`O teu voto foi guardado com sucesso!\n\n**O teu voto:** ${votoTexto}\n\n*Receberás um aviso quando a votação for finalizada.*`)
                    .setColor('#313137');
                await interaction.update({ content: '', embeds: [embedVotoRegistado], components: [] });
            } else {
                await interaction.reply({ content: `✅ O teu voto anónimo (${votoTexto}) foi registado com sucesso.`, ephemeral: true });
            }

            try {
                const rolePremade = guild.roles.cache.get(ROLE_PREMADE_ID);
                if (!rolePremade) return;

                const totalVotantes = rolePremade.members.filter(m => !m.user.bot).size;
                const votosTotais = votosSim + votosNao;

                console.log(`\n--- STATUS DA VOTAÇÃO ---`);
                console.log(`Votos Sim: ${votosSim} | Votos Não: ${votosNao} | Total Votantes: ${totalVotantes} | Registados: ${votosTotais}`);

                // Lógica de Early Exit (Fim Antecipado Mágico)
                const votosRestantes = totalVotantes - votosTotais;

                // 1. Rejeição Garantida: Se mesmo que todos os restantes votassem SIM, não chegava a 70%
                const maxVotosSimPossiveis = votosSim + votosRestantes;
                const percentagemMaximaPossivel = (maxVotosSimPossiveis / totalVotantes) * 100;

                // 2. Aprovação Garantida: Se os votos SIM atuais já garantem os 70%
                const percentagemAtualGarantida = (votosSim / totalVotantes) * 100;

                if (votosTotais >= totalVotantes || percentagemMaximaPossivel < 70 || percentagemAtualGarantida >= 70) {
                    encerrarVotacao(guild);
                }
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

    // Obter o tamanho total da equipa para contas exatas
    let totalVotantes = votosSim + votosNao; // Fallback
    try {
        const role = guild.roles.cache.get(ROLE_PREMADE_ID);
        if (role) totalVotantes = role.members.filter(m => !m.user.bot).size;
    } catch (e) { }

    const percentagem = totalVotantes === 0 ? 0 : (votosSim / totalVotantes) * 100;
    const aprovado = percentagem >= 70;

    const embedFinalDM = new EmbedBuilder()
        .setTitle('⚖️・Votação terminada!')
        .setDescription(`A votação para o <@${candidatoId}> terminou.\nObteve **${percentagem.toFixed(1)}%** de aprovação de toda a equipa (precisava de 70%).\n\nA Favor: ${votosSim}\nContra: ${votosNao}\nMembros na Equipa: ${totalVotantes}\n\`\`\`\nMembro ${aprovado ? 'Aprovado ✅' : 'Rejeitado ❌'}\n\`\`\``)
        .setColor(aprovado ? 'Green' : 'Red');

    const embedFinalCanal = new EmbedBuilder()
        .setTitle('⚖️・Votação terminada!')
        .setDescription(`A votação para o <@${candidatoId}> terminou.\nObteve **${percentagem.toFixed(1)}%** de aprovação de toda a equipa (precisava de 70%).\n\nA Favor: ${votosSim}\nContra: ${votosNao}\nMembros na Equipa: ${totalVotantes}\n\`\`\`\nMembro ${aprovado ? 'Aprovado ✅' : 'Rejeitado ❌'}\n\`\`\`\n\n⏳ *O painel de recrutamento ficará novamente disponível em 10 segundos...*`)
        .setColor(aprovado ? 'Green' : 'Red');

    if (mensagemVotacao) {
        try {
            await mensagemVotacao.edit({ embeds: [embedFinalCanal], components: [] });
        } catch (e) {
            console.error("Não foi possível editar a mensagem da votação:", e);
        }
    }

    if (aprovado) {
        try {
            const membroCandidato = await guild.members.fetch(candidatoId);
            if (membroCandidato) {
                await membroCandidato.roles.add(ROLE_PREMADE_ID);

                // Mensagem de Boas Vindas no Canal Público
                const canalBoasVindas = guild.channels.cache.get(CANAL_BOAS_VINDAS_ID);
                if (canalBoasVindas) {
                    const embedBoasVindas = new EmbedBuilder()
                        .setTitle('♣️・Novo Membro na Premade!')
                        .setThumbnail(membroCandidato.user.displayAvatarURL())
                        .setDescription(`・Dêem as boas-vindas ao <@${candidatoId}>!\n・Passou na votação e faz parte **Premade**. ♠️♦️\n\n<#1504505678507802714> - Aqui podes ver o Nosso Spam!\n<#1504505830911901748> - Aqui podes ver a Nossa Leaderboard!\n<#1504505769557754026> - Aqui podes ver quem Está a Jogar!\n<#1504505631279812699> - Aqui podes Sugerir jogadores para a Premade!`)
                        .setColor('#313137');

                    await canalBoasVindas.send({ content: `Bem-vindo(a), <@${candidatoId}>!`, embeds: [embedBoasVindas] });
                } else {
                    console.log("Aviso: O Canal de Boas Vindas não foi encontrado. Verifica o ID configurado!");
                }
            }
        } catch (error) {
            console.log("Erro a dar cargo ao membro aprovado:", error);
        }
    }

    // Enviar o aviso final para as DMs de quem estava a votar (toda a premade)
    try {
        const role = guild.roles.cache.get(ROLE_PREMADE_ID);
        if (role) {
            role.members.forEach(async (membro) => {
                if (!membro.user.bot) {
                    try {
                        await membro.send({ embeds: [embedFinalDM] });
                    } catch (e) { }
                }
            });
        }
    } catch (error) {
        console.error("Erro a enviar resultado por DM:", error);
    }

    // Timeout para gerar novo painel automaticamente
    if (mensagemVotacao) {
        const canal = mensagemVotacao.channel;
        const oldMessage = mensagemVotacao;

        setTimeout(async () => {
            try {
                // Apaga a mensagem da votação antiga
                await oldMessage.delete().catch(() => { });

                // Novo Painel
                const embedPainel = new EmbedBuilder()
                    .setTitle('🙍・𝖠𝖽𝗂𝖼𝗂𝗈𝗇𝖺𝗋 𝖯𝖾𝗌𝗌𝗈𝖺𝗅')
                    .setDescription('### Propõe a entrada de um novo jogador na premade.\n ・Basta selecionares a pessoa no menu abaixo!\n ・70% da Premade tem de estar de acordo!')
                    .setColor('#313137');

                const rowPainel = new ActionRowBuilder()
                    .addComponents(
                        new UserSelectMenuBuilder()
                            .setCustomId('select_candidato')
                            .setPlaceholder('Seleciona o membro a propor...')
                    );

                await canal.send({ embeds: [embedPainel], components: [rowPainel] });
            } catch (e) {
                console.error("Erro a gerar novo painel automático:", e);
            }
        }, 10 * 1000); // 10 segundos para testes
    }
}
