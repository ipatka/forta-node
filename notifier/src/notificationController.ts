import axios from 'axios'
import TelegramBot from 'node-telegram-bot-api'
import { Get, Post, QueryParam, BodyParam, JsonController } from 'routing-controllers'
import { BigNumber, utils } from 'ethers'
import { APIEmbed, EmbedBuilder } from 'discord.js'

const botKey = process.env.TELEGRAMKEY
const chatId = '-858059392'
const explorerUrl = 'https://securityalliance.dev/'

let bot: TelegramBot
if (botKey) bot = new TelegramBot(botKey, { polling: false })
const discordWebhookId = process.env.DISCORDWEBHOOK

console.log({ discordWebhookId })

interface FortaAlertBase {
    name: string
    description: string
    severity: string
    alertId: string
    transactionHash: string
    protocol: string
    addresses: string[]
    createdAt: string
    type: string
    source: {
        block: {
            chainId: number
            hash: string
            number: string
            timestamp: string
        }
        transactionHash: string
        bot: {
            id: string
        }
    }
    metadata: { [key: string]: any }
}

enum FortaAlertIds {
    market = 'AE-COMET-EVENT',
    oracle = 'AE-COMP-CTOKEN-PRICE-REJECTED',
}

const discordAlertTitles = {
    [FortaAlertIds.market]: 'Comet Market Monitor (Simulation)',
    [FortaAlertIds.oracle]: 'Oracle Price Monitor (Simulation)',
}

interface FortaMarketAlert extends FortaAlertBase {
    alertId: FortaAlertIds.market
    metadata: {
        symbol: string
        amount: string
        usdValue: string
    }
}

interface FortaOracleAlert extends FortaAlertBase {
    alertId: FortaAlertIds.oracle
    metadata: {
        anchorPrice: string
        cTokenAddress: string
        protocolVersion: string
        reporterPrice: string
        underlyingTokenAddress: string
        validatorProxyAddress: string
    }
}

type FortaAlert = FortaMarketAlert | FortaOracleAlert

const formatPrice = (price: string) => {
    const priceBn = BigNumber.from(price)
    const remainder = priceBn.mod(1e5)
    const formatted = utils.formatUnits(priceBn.sub(remainder), 6)
    return formatted
}

function toEscapeMsg(str: string): string {
    return str.replace(/_/gi, '\\_').replace(/-/gi, '\\-').replace('~', '\\~').replace(/`/gi, '\\`').replace(/\./g, '\\.')
}

const usdFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',

    // These options are needed to round to whole numbers if that's what you want.
    //minimumFractionDigits: 0, // (this suffices for whole numbers, but will print 2500.10 as $2,500.1)
    //maximumFractionDigits: 0, // (causes 2500.99 to be printed as $2,501)
})

const formatTelegramAlert = (alert: FortaAlert) => {
    let formattedAlert: string
    switch (alert.alertId) {
        case FortaAlertIds.market:
            formattedAlert = `️💰 [TX](${explorerUrl}tx/${alert.source.transactionHash}) ${alert.description} \n Asset: ${
                alert.metadata.symbol
            }\n Amount: ${parseFloat(alert.metadata.amount).toFixed(2)}\n Value: ${usdFormatter.format(parseInt(alert.metadata.usdValue))}`

            break
        case FortaAlertIds.oracle:
            formattedAlert = `⚠️ [TX](${explorerUrl}tx/${alert.source.transactionHash}) Reported price of ${
                alert.metadata.cTokenAddress
            } was rejected\n Anchor Price: ${formatPrice(alert.metadata.anchorPrice)}\n Reporter Price: ${formatPrice(alert.metadata.reporterPrice)}`

            break

        default:
            throw new Error('Invalid alert type')
    }
    return toEscapeMsg(formattedAlert)
}

const formatDiscordAlert = (alert: FortaAlert) => {
    const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(discordAlertTitles[alert.alertId])
        .setURL(`${explorerUrl}tx/${alert.source.transactionHash}`)
        .setAuthor({
            name: 'Forta (Simulation)',
            iconURL: 'https://github-production-user-asset-6210df.s3.amazonaws.com/4401444/250399693-e75d751d-5442-4bbb-b166-845e17c7393a.png',
            url: 'https://securityalliance.dev/',
        })
        .setDescription(formatTelegramAlert(alert))
        .setTimestamp()

    return embed.data
}

const sendTelegramAlert = async (chat: string, message: string) => {
    if (!bot) throw new Error ('NO BOT KEY')
    const res = await bot.sendMessage(chat, message, { parse_mode: 'MarkdownV2' })
    return res
}

const sendDiscordAlert = async (webhook: string, embeds: APIEmbed[]) => {
    const url = `https://discord.com/api/webhooks/${webhook}`
    const result = await axios.post(
        url,
        {
            embeds,
        },
        {
            headers: {
                'Content-Type': 'application/json',
            },
        }
    )
    return result.status
}

@JsonController()
export class NotificationController {
    @Get('/health')
    async health() {
        return 'I am alive'
    }

    @Get('/telegram')
    async sendTelegram(@QueryParam('message') message: string) {
        const status = await sendTelegramAlert(chatId, message)
        return 'This action sent a message: ' + message + ` with status: ` + status
    }

    @Get('/discord')
    async sendDiscord(@QueryParam('message') message: string) {
        const exampleEmbed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('Security Alliance Test(Simulation)')
            .setAuthor({
                name: 'Forta (Simulation)',
                iconURL: 'https://github-production-user-asset-6210df.s3.amazonaws.com/4401444/250399693-e75d751d-5442-4bbb-b166-845e17c7393a.png',
                url: 'https://securityalliance.dev/',
            })
            .setDescription(message)
            .setTimestamp()

        if (discordWebhookId) await sendDiscordAlert(discordWebhookId, [exampleEmbed.data])
        else console.warn('NO WEBHOOK ID')
        return 'This action sent alert'
    }

    @Post('/forta')
    async post(@BodyParam('alerts') alerts: FortaAlert[]) {
        for await (const alert of alerts) {
            console.log({ alert })
            const message = formatTelegramAlert(alert)
            await sendTelegramAlert(chatId, message)
            const discordMessage = formatDiscordAlert(alert)
            if (discordWebhookId) await sendDiscordAlert(discordWebhookId, [discordMessage])
            else console.warn('NO WEBHOOK ID')
        }
        return 'This action sent alert'
    }
}

// at the top of your file

// inside a command, event listener, etc.
