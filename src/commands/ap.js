const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const ROLE_PREMADE_ID = '1504240255296081920';
const TEU_ID_ADMIN = '408738678492364801';
const CANAL_BOAS_VINDAS_ID = '1504558308474884167';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ap')
        .setDescription('Comando para admins: Adiciona um membro diretamente à premade.')
        .addUserOption(option =>
            option.setName('membro')
                .setDescription('O membro que queres adicionar à premade')
                .setRequired(true)),
    async execute(interaction) {
        if (interaction.user.id !== TEU_ID_ADMIN) {
            console.log(`[/ap] ACESSO NEGADO: ${interaction.user.tag} tentou usar /ap sem ser admin.`);
            return interaction.reply({ content: 'Só o admin pode adicionar membros diretamente à premade!', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        const targetUser = interaction.options.getUser('membro');
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            console.log(`[/ap] ${interaction.user.tag} tentou adicionar ${targetUser.tag} mas o membro não foi encontrado.`);
            return interaction.editReply({ content: '❌ Membro não encontrado no servidor.' });
        }

        if (targetMember.roles.cache.has(ROLE_PREMADE_ID)) {
            console.log(`[/ap] ${interaction.user.tag} tentou adicionar ${targetUser.tag} mas já está na premade.`);
            return interaction.editReply({ content: `⚠️ O <@${targetUser.id}> já está na premade.` });
        }

        try {
            await targetMember.roles.add(ROLE_PREMADE_ID);
            console.log(`[/ap] ${interaction.user.tag} adicionou ${targetUser.tag} (${targetUser.id}) à premade diretamente.`);

            // Mensagem de Boas Vindas no Canal Público
            const canalBoasVindas = interaction.guild.channels.cache.get(CANAL_BOAS_VINDAS_ID);
            if (canalBoasVindas) {
                const embedBoasVindas = new EmbedBuilder()
                    .setTitle('♣️・Novo Membro na Premade!')
                    .setThumbnail(targetMember.user.displayAvatarURL())
                    .setDescription(`・Dêem as boas-vindas ao <@${targetUser.id}>!\n・Foi adicionado pelo admin e faz parte da **Premade**. ♠️♦️\n\n<#1504505678507802714> - Aqui podes ver o Nosso Spam!\n<#1504505830911901748> - Aqui podes ver a Nossa Leaderboard!\n<#1504505769557754026> - Aqui podes ver quem Está a Jogar!\n<#1504505631279812699> - Aqui podes Sugerir jogadores para a Premade!`)
                    .setColor('#313137');

                await canalBoasVindas.send({ content: `Bem-vindo(a), <@${targetUser.id}>!`, embeds: [embedBoasVindas] });
            }

            // Pedido Faceit na DM do novo membro
            try {
                const embedFaceit = new EmbedBuilder()
                    .setTitle('🎮 Associa a tua conta Faceit!')
                    .setDescription('Foste adicionado à premade! Precisamos do teu Nick da Faceit para te adicionar à Leaderboard da equipa.\n\nClica no botão abaixo. Tens **3 horas** para o fazer.\n\n*Se te enganares ou passar o tempo, clica no botão de Ajuda.*')
                    .setColor('#FF5500');

                const faceitMsg = await targetMember.send({ embeds: [embedFaceit] });

                const rowFaceit = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId(`btn_get_fcid_${targetUser.id}_${faceitMsg.id}`).setLabel('Como funciona?').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`btn_add_faceit_${targetUser.id}_${faceitMsg.id}`).setLabel('Sincronizar com a Faceit').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId(`btn_call_admin_${targetUser.id}_${faceitMsg.id}`).setLabel('Pedir Ajuda ao Admin').setStyle(ButtonStyle.Danger).setDisabled(true)
                    );
                await faceitMsg.edit({ components: [rowFaceit] });

                // Timer de 3 horas
                setTimeout(async () => {
                    try {
                        const currentMsg = await faceitMsg.fetch();
                        if (currentMsg.components[0].components[0].disabled === false) {
                            const timeoutRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`btn_get_fcid_${targetUser.id}_${faceitMsg.id}`).setLabel('Como funciona?').setStyle(ButtonStyle.Secondary).setDisabled(true),
                                new ButtonBuilder().setCustomId(`btn_add_faceit_${targetUser.id}_${faceitMsg.id}`).setLabel('Sincronizar com a Faceit').setStyle(ButtonStyle.Primary).setDisabled(true),
                                new ButtonBuilder().setCustomId(`btn_call_admin_${targetUser.id}_${faceitMsg.id}`).setLabel('Pedir Ajuda ao Admin').setStyle(ButtonStyle.Danger).setDisabled(false)
                            );
                            await faceitMsg.edit({ components: [timeoutRow] });
                        }
                    } catch (e) {}
                }, 3 * 60 * 60 * 1000);

            } catch (e) {
                console.error(`[/ap] Erro a enviar DM de Faceit a ${targetUser.tag}:`, e);
            }

            await interaction.editReply({ content: `✅ <@${targetUser.id}> foi adicionado à premade com sucesso! Foi-lhe enviada uma DM a pedir o Nick da Faceit.` });

        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: '❌ Ocorreu um erro ao tentar adicionar o cargo. (Verifica se o Bot tem permissões suficientes na hierarquia!)' });
        }
    },
};
