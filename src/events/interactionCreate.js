const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getLeaderboard, saveLeaderboard, updateLeaderboardMessage } = require('../commands/leaderboard.js');

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

        // ==========================================
        // Lógica de Adição Automática de Faceit
        // ==========================================
        if (interaction.isButton() && interaction.customId.startsWith('btn_add_faceit_')) {
            const parts = interaction.customId.split('_');
            const candidatoId = parts[3];
            const msgId = parts[4];
            console.log(`[Faceit] ${interaction.user.tag} abriu o modal de associação Faceit (discord_id: ${candidatoId})`);

            const modal = new ModalBuilder()
                .setCustomId(`modal_add_faceit_${candidatoId}_${msgId}`)
                .setTitle('Associar Conta Faceit');

            const nickInput = new TextInputBuilder()
                .setCustomId('faceit_nick')
                .setLabel("O teu Nickname na Faceit:")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(nickInput)
            );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('btn_call_admin_')) {
            const parts = interaction.customId.split('_');
            const candidatoId = parts[3];
            const msgId = parts[4];
            console.log(`[Faceit] ${interaction.user.tag} pediu ajuda ao admin para associar Faceit (discord_id: ${candidatoId})`);

            const newRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`btn_get_fcid_${candidatoId}_${msgId}`).setLabel('Como funciona?').setStyle(ButtonStyle.Primary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`btn_add_faceit_${candidatoId}_${msgId}`).setLabel('Sincronizar com a Faceit').setStyle(ButtonStyle.Primary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`btn_call_admin_${candidatoId}_${msgId}`).setLabel('Pedido Enviado!').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );
            await interaction.update({ components: [newRow] });

            try {
                const admin = await interaction.client.users.fetch(TEU_ID_ADMIN);
                if (admin) {
                    const rowAdmin = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`btn_admin_reactivate_${candidatoId}_${msgId}_${interaction.user.id}`)
                            .setLabel('Reativar Botão do Utilizador')
                            .setStyle(ButtonStyle.Success)
                    );
                    await admin.send({
                        content: `🚨 **Pedido de Ajuda Faceit** 🚨\nO utilizador <@${interaction.user.id}> precisa de ajuda para associar a sua conta Faceit (Tempo expirou ou falhou no Nick).\n\nClica no botão para lhe dares mais uma tentativa de inserir o nome.`,
                        components: [rowAdmin]
                    });
                }
            } catch (e) {
                console.error("Erro a contactar admin:", e);
            }
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('btn_admin_reactivate_')) {
            if (interaction.user.id !== TEU_ID_ADMIN) {
                console.log(`[Faceit] ACESSO NEGADO: ${interaction.user.tag} tentou reativar botão sem ser admin.`);
                return interaction.reply({ content: 'Não tens permissão.', flags: 64 });
            }
            const parts = interaction.customId.split('_');
            const candidatoId = parts[3];
            const msgId = parts[4];
            const userId = parts[5];

            await interaction.deferUpdate();

            try {
                const user = await interaction.client.users.fetch(userId);
                const dmChannel = await user.createDM();
                const faceitMsg = await dmChannel.messages.fetch(msgId);

                const reactivatedRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId(`btn_get_fcid_${candidatoId}_${msgId}`).setLabel('Como funciona?').setStyle(ButtonStyle.Secondary).setDisabled(false),
                        new ButtonBuilder().setCustomId(`btn_add_faceit_${candidatoId}_${msgId}`).setLabel('Sincronizar com a Faceit').setStyle(ButtonStyle.Primary).setDisabled(false),
                        new ButtonBuilder().setCustomId(`btn_call_admin_${candidatoId}_${msgId}`).setLabel('Pedir Ajuda ao Admin').setStyle(ButtonStyle.Danger).setDisabled(true)
                    );

                await faceitMsg.edit({ components: [reactivatedRow], content: '' });

                setTimeout(async () => {
                    try {
                        const currentMsg = await dmChannel.messages.fetch(msgId);
                        if (currentMsg.components[0].components[0].disabled === false) {
                            const timeoutRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`btn_get_fcid_${candidatoId}_${msgId}`).setLabel('Como funciona?').setStyle(ButtonStyle.Secondary).setDisabled(true),
                                new ButtonBuilder().setCustomId(`btn_add_faceit_${candidatoId}_${msgId}`).setLabel('Sincronizar com a Faceit').setStyle(ButtonStyle.Primary).setDisabled(true),
                                new ButtonBuilder().setCustomId(`btn_call_admin_${candidatoId}_${msgId}`).setLabel('Pedir Ajuda ao Admin').setStyle(ButtonStyle.Danger).setDisabled(false)
                            );
                            await currentMsg.edit({ components: [timeoutRow] });
                        }
                    } catch (e) { }
                }, 3 * 60 * 60 * 1000);

                console.log(`[Faceit] Admin reativou o botão de Faceit para o utilizador ${userId}.`);
                await interaction.followUp({ content: `✅ Botão reativado com sucesso na DM do utilizador <@${userId}>.`, flags: 64 });
            } catch (e) {
                console.error("Erro a reativar botão:", e);
                await interaction.followUp({ content: `❌ Não consegui encontrar a mensagem ou utilizador para reativar o botão.`, flags: 64 });
            }
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_add_faceit_')) {
            await interaction.deferUpdate();

            const parts = interaction.customId.split('_');
            const candidatoId = parts[3];
            const msgId = parts[4];
            const nick = interaction.fields.getTextInputValue('faceit_nick').trim();
            const apiKey = process.env.FACEIT_API_KEY;

            async function disableAndAskHelp(errorMsg) {
                const errRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`btn_get_fcid_${candidatoId}_${msgId}`).setLabel('Como funciona?').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`btn_add_faceit_${candidatoId}_${msgId}`).setLabel('Sincronizar com a Faceit').setStyle(ButtonStyle.Primary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`btn_call_admin_${candidatoId}_${msgId}`).setLabel('Pedir Ajuda ao Admin').setStyle(ButtonStyle.Danger).setDisabled(false)
                );
                try {
                    await interaction.message.edit({
                        content: `❌ **Erro:** ${errorMsg}\nClica no botão de ajuda em baixo para o Admin intervir.`,
                        components: [errRow]
                    });
                } catch (e) { }
            }

            console.log(`[Faceit] ${interaction.user.tag} submeteu modal — nick: "${nick}"`);

            if (!apiKey) return disableAndAskHelp('A chave de API do BOT não está configurada. Contacta o admin.');

            const leaderboard = getLeaderboard();
            if (leaderboard.find(p => p.nickname.toLowerCase() === nick.toLowerCase())) {
                console.log(`[Faceit] Rejeitado: nick "${nick}" já existe na leaderboard.`);
                return disableAndAskHelp(`O jogador **${nick}** já está na leaderboard.`);
            }

            try {
                const playerResponse = await fetch(`https://open.faceit.com/data/v4/players?nickname=${nick}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });

                if (playerResponse.status === 404) return disableAndAskHelp(`Não foi possível encontrar o jogador **${nick}** na Faceit.`);
                if (!playerResponse.ok) return disableAndAskHelp(`Erro da API da Faceit (Status: ${playerResponse.status}).`);

                const playerData = await playerResponse.json();

                if (!playerData.games?.cs2) return disableAndAskHelp(`O jogador **${nick}** não tem perfil de CS2 registado.`);

                leaderboard.push({
                    nickname: playerData.nickname,
                    player_id: playerData.player_id,
                    discord_id: candidatoId
                });
                saveLeaderboard(leaderboard);
                console.log(`[Leaderboard] Adicionado via API — nick: ${playerData.nickname} | player_id: ${playerData.player_id} | discord_id: ${candidatoId}`);

                const embedSuccess = EmbedBuilder.from(interaction.message.embeds[0])
                    .setDescription(`✅ Conta associada com sucesso ao nickname **${playerData.nickname}**!\nEstás agora na nossa Leaderboard oficial.`)
                    .setColor('Green');

                await interaction.message.edit({ embeds: [embedSuccess], components: [], content: '' });

                await updateLeaderboardMessage(interaction.client);

                // Enviar DM ao admin com o Faceit ID e o botão
                try {
                    const admin = await interaction.client.users.fetch(TEU_ID_ADMIN);
                    if (admin) {
                        const goldEmbed = new EmbedBuilder()
                            .setTitle('🏆・Novo Faceit ID Associado!')
                            .setDescription(`O jogador <@${candidatoId}> associou com sucesso a sua conta Faceit.\n\n### Informações do Jogador:\n・**Nickname:** \`${playerData.nickname}\`\n・**Faceit ID:** \`${playerData.player_id}\`\n\nAdiciona este ID na configuração de Webhooks da Faceit para começar a monitorizar as suas partidas.`)
                            .setColor('#FFD700'); // Cor Dourada (Gold)

                        const devButton = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setLabel('Ir para o Faceit Dev Portal')
                                .setURL('https://developers.faceit.com/apps/b2b53f4e-666e-48f1-b6ba-03ecbc6b9559/webhooks/f6511e40-987d-4330-a423-911b30a65e5f/edit')
                                .setStyle(ButtonStyle.Link)
                        );

                        await admin.send({ embeds: [goldEmbed], components: [devButton] });
                        console.log(`[Faceit] DM enviada ao admin com o Faceit ID de ${playerData.nickname}`);
                    }
                } catch (e) {
                    console.error("Erro ao enviar Faceit ID ao admin por DM:", e);
                }

            } catch (error) {
                console.error(error);
                return disableAndAskHelp("Ocorreu um erro interno a verificar o teu nome.");
            }
            return;
        }

        // 1. Lógica do menu de seleção (Painel)
        if (interaction.isUserSelectMenu() && interaction.customId === 'select_candidato') {
            if (votacaoAtiva) {
                console.log(`[Votação] ${interaction.user.tag} tentou iniciar votação mas já existe uma a decorrer.`);
                return interaction.reply({ content: 'Já existe uma votação a decorrer!', flags: 64 });
            }

            candidatoId = interaction.values[0];
            votacaoAtiva = true;
            votosSim = 0;
            votosNao = 0;
            quemJaVotou.clear();
            console.log(`[Votação] ${interaction.user.tag} iniciou votação para o candidato discord_id: ${candidatoId}`);

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
            if (!votacaoAtiva) return interaction.reply({ content: 'Esta votação já terminou.', flags: 64 });

            // O botão foi carregado na DM, logo interaction.guild é null.
            // Precisamos do guild para verificar o cargo e para contar os votos.
            const guild = interaction.guild || mensagemVotacao.guild;

            const member = await guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !member.roles.cache.has(ROLE_PREMADE_ID)) {
                return interaction.reply({ content: 'Só quem está na premade pode votar.', flags: 64 });
            }

            if (quemJaVotou.has(interaction.user.id)) return interaction.reply({ content: 'Já votaste nesta pessoa! Não tentes aldrabar.', flags: 64 });

            quemJaVotou.add(interaction.user.id);
            if (interaction.customId === 'btn_sim') votosSim++;
            if (interaction.customId === 'btn_nao') votosNao++;
            console.log(`[Votação] ${interaction.user.tag} votou ${interaction.customId === 'btn_sim' ? 'A FAVOR' : 'CONTRA'} | Sim: ${votosSim} | Não: ${votosNao}`);

            const votoTexto = interaction.customId === 'btn_sim' ? 'a Favor' : 'Contra';

            // Na DM usamos update para limpar os botões e mostrar o resumo do voto
            if (!interaction.guild) {
                const embedVotoRegistado = new EmbedBuilder()
                    .setTitle('🗳️・Voto Registado')
                    .setDescription(`O teu voto foi guardado com sucesso!\n\n**O teu voto:** ${votoTexto}\n\n*Receberás um aviso quando a votação for finalizada.*`)
                    .setColor('#313137');
                await interaction.update({ content: '', embeds: [embedVotoRegistado], components: [] });
            } else {
                await interaction.reply({ content: `✅ O teu voto anónimo (${votoTexto}) foi registado com sucesso.`, flags: 64 });
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
            console.log(`[Comando] /${interaction.commandName} usado por ${interaction.user.tag} (${interaction.user.id}) em #${interaction.channel?.name || 'DM'}`);

            // Apanhar o comando /ffv localmente para ter acesso ao estado
            if (interaction.commandName === 'ffv') {
                if (interaction.user.id !== TEU_ID_ADMIN) return interaction.reply({ content: 'Só o admin pode forçar o fim da votação!', flags: 64 });
                if (!votacaoAtiva) return interaction.reply({ content: 'Não há nenhuma votação ativa para terminar.', flags: 64 });

                await interaction.reply({ content: 'Forçaste o fim da votação.', flags: 64 });
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
                    await interaction.followUp({ content: 'Ocorreu um erro ao executar este comando!', flags: 64 });
                } else {
                    await interaction.reply({ content: 'Ocorreu um erro ao executar este comando!', flags: 64 });
                }
            }
        }
    }
};

async function encerrarVotacao(guild) {
    votacaoAtiva = false;
    console.log(`[Votação] A encerrar votação para discord_id: ${candidatoId} | Sim: ${votosSim} | Não: ${votosNao}`);

    // Obter o tamanho total da equipa para contas exatas
    let totalVotantes = votosSim + votosNao; // Fallback
    try {
        const role = guild.roles.cache.get(ROLE_PREMADE_ID);
        if (role) totalVotantes = role.members.filter(m => !m.user.bot).size;
    } catch (e) { }

    const percentagem = totalVotantes === 0 ? 0 : (votosSim / totalVotantes) * 100;
    const aprovado = percentagem >= 70;
    console.log(`[Votação] Resultado: ${aprovado ? 'APROVADO ✅' : 'REJEITADO ❌'} | ${percentagem.toFixed(1)}% aprovação (mínimo: 70%)`);

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
                console.log(`[Votação] Cargo de premade atribuído a ${membroCandidato.user.tag} (${candidatoId}).`);

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

                // Pedido Faceit na DM do Candidato
                try {
                    const embedFaceit = new EmbedBuilder()
                        .setTitle('🎮 Associa a tua conta Faceit!')
                        .setDescription('Parabéns pela aprovação! Precisamos do teu Nick da Faceit para te adicionar à Leaderboard da equipa.\n\nClica no botão "Adicionar Nick" abaixo. Tens **3 horas** para o fazer.\n\n*Se te enganares ou passar o tempo, clica no botão de Ajuda.*')
                        .setColor('#FF5500');

                    const faceitMsg = await membroCandidato.send({ embeds: [embedFaceit] });

                    const rowFaceit = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder().setCustomId(`btn_get_fcid_${candidatoId}_${faceitMsg.id}`).setLabel('Como funciona?').setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder().setCustomId(`btn_add_faceit_${candidatoId}_${faceitMsg.id}`).setLabel('Sincronizar com a Faceit').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId(`btn_call_admin_${candidatoId}_${faceitMsg.id}`).setLabel('Pedir Ajuda ao Admin').setStyle(ButtonStyle.Danger).setDisabled(true)
                        );
                    await faceitMsg.edit({ components: [rowFaceit] });

                    // Timer de 3 horas (10800000 ms)
                    setTimeout(async () => {
                        try {
                            const currentMsg = await faceitMsg.fetch();
                            if (currentMsg.components[0].components[0].disabled === false) {
                                const timeoutRow = new ActionRowBuilder().addComponents(
                                    new ButtonBuilder().setCustomId(`btn_get_fcid_${candidatoId}_${faceitMsg.id}`).setLabel('Como funciona?').setStyle(ButtonStyle.Secondary).setDisabled(true),
                                    new ButtonBuilder().setCustomId(`btn_add_faceit_${candidatoId}_${faceitMsg.id}`).setLabel('Sincronizar com a Faceit').setStyle(ButtonStyle.Primary).setDisabled(true),
                                    new ButtonBuilder().setCustomId(`btn_call_admin_${candidatoId}_${faceitMsg.id}`).setLabel('Pedir Ajuda ao Admin').setStyle(ButtonStyle.Danger).setDisabled(false)
                                );
                                await faceitMsg.edit({ components: [timeoutRow] });
                            }
                        } catch (e) { }
                    }, 3 * 60 * 60 * 1000);
                } catch (e) {
                    console.error("Erro a enviar pedido Faceit ao candidato:", e);
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
