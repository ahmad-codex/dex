const { expectRevert } = require("@openzeppelin/test-helpers");
const { web3 } = require("@openzeppelin/test-helpers/src/setup");

//to deploy mock ERC20 tokens
const Dai = artifacts.require('mocks/Dai.sol');
const Rep = artifacts.require('mocks/Rep.sol');
const Bat = artifacts.require('mocks/Bat.sol');
const Zrx = artifacts.require('mocks/Zrx.sol');

//to deploy the dex smart contract
const Dex = artifacts.require('Dex.sol');

const SIDE = {
    BUY: 0,
    SELL: 1
};

contract('Dex', (accounts) => {
    let dai, bat, rep, zrx, dex;
    const [trader1, trader2] = [accounts[1], accounts[2]];//we don't start with accounts[0] as it is the admin just to separate the roles
    const [DAI, BAT, REP, ZRX] = ['DAI', 'BAT', 'REP', 'ZRX']
        .map(ticker => web3.utils.fromAscii(ticker));

    //runs before each test
    //to deploy ERC20 tokens & dex smart contracts
    beforeEach(async () => {
        ([dai, bat, rep, zrx] = await Promise.all([
            Dai.new(),
            Bat.new(),
            Rep.new(),
            Zrx.new()
        ]));
        dex = await Dex.new();
        await Promise.all([
            dex.addToken(DAI, dai.address),
            dex.addToken(BAT, bat.address),
            dex.addToken(REP, rep.address),
            dex.addToken(ZRX, zrx.address),
        ]);

        //Allocate initial token balances to some addresses to test the smart contract 
        const amount = web3.utils.toWei('1000');

        //define helper function to allocate ERC20 token
        const seedTokenBalance = async (token, trader) => {
            await token.faucet(trader, amount);//add tokens to the trader balance
            
            //next, the trader should approve the dex to transfer all his tokens to easily allow deposit in the dex smart contract later
            await token.approve(
                dex.address, 
                amount,
                {from: trader});
        }

        await Promise.all(
            [dai, bat, rep, zrx].map(
                token => seedTokenBalance(token, trader1)
            )
        );  
        await Promise.all(
            [dai, bat, rep, zrx].map(
                token => seedTokenBalance(token, trader2)
            )
        );      
    });

    //deposit
    //happy path
    it('Should deposit tokens', async () => {
        const amount = web3.utils.toWei('100');//define amount of token we want to deposit
        
        await dex.deposit(
            amount, 
            DAI, 
            {from: trader1});

        const balance = await dex.traderBalances(trader1, DAI);
        assert(balance.toString() === amount);
    });

    //uphappy path
    it('Should NOT deposit tokens if token does not exist', async () => {
        await expectRevert(
            dex.deposit(
                web3.utils.toWei('100'), 
                web3.utils.fromAscii('TOKEN-DOES-NOT-EXIST'), 
                {from: trader1}),
            'this token does not exist'
        ); 
    });

    //withdraw
    //happy path
    it('Should withdraw tokens', async () => {
        const amount = web3.utils.toWei('100');
        
        await dex.deposit(
            amount, 
            DAI, 
            {from: trader1});

        await dex.withdraw(
            amount, 
            DAI, 
            {from: trader1});

        //check the balance in dex & the token smart contracts
        const [balanceDex, balanceDai] = Promise.all(
            [
                dex.traderBalances(trader1, DAI),
                dai.balanceOf(trader1)
            ]
        );
        assert(balanceDex.isZero());
        assert(balanceDai.toString() === web3.utils.toWei('1000'));
    });

    //uphappy path
    it('Should NOT withdraw tokens if token does not exist', async () => {
        await expectRevert(
            dex.withdraw(
                web3.utils.toWei('100'), 
                web3.utils.fromAscii('TOKEN-DOES-NOT-EXIST'), 
                {from: trader1}),
            'this token does not exist'
        ); 
    });

    //uphappy path
    it('Should NOT withdraw tokens if balance is too low', async () => {
        await dex.deposit(
            web3.utils.toWei('100'), 
            DAI, 
            {from: trader1});

        await expectRevert(
            await dex.withdraw(
                web3.utils.toWei('200'), 
                DAI, 
                {from: trader1}),
            'balance too low'
        ); 
    });

    //create limit order
    //happy path
    it('Should create limit order', async () => {
        await dex.deposit(
            web3.utils.toWei('100'), 
            DAI, 
            {from: trader1});

        await dex.createLimitOrder(
            REP,
            web3.utils.toWei('10'),
            10,
            SIDE.BUY,
            {from: trader1});
        
        //check buy orders
        let buyOrders = await dex.getOrders(REP, SIDE.BUY);
        let sellOrders = await dex.getOrders(REP, SIDE.SELL);

        assert(buyOrders.length === 1);
        assert(buyOrders[0].trader === trader1);
        assert(buyOrders[0].ticker === web3.utils.padRight(REP, 64));
        assert(buyOrders[0].price === '10');
        assert(buyOrders[0].amount === web3.utils.toWei('10'));
        assert(buyOrders[0].side === SIDE.BUY.toString());
        assert(sellOrders.length === 0);

        await dex.deposit(
            web3.utils.toWei('200'), 
            DAI, 
            {from: trader2});

        await dex.createLimitOrder(
            REP,
            web3.utils.toWei('10'),
            11,
            SIDE.BUY,
            {from: trader2});
        
        buyOrders = await dex.getOrders(REP, SIDE.BUY);
        sellOrders = await dex.getOrders(REP, SIDE.SELL);
        assert(buyOrders.length === 2);
        assert(buyOrders[0].trader === trader2);
        assert(buyOrders[1].trader === trader1);
        assert(sellOrders.length === 0);

        await dex.createLimitOrder(
            REP,
            web3.utils.toWei('10'),
            9,
            SIDE.BUY,
            {from: trader2});
        
        buyOrders = await dex.getOrders(REP, SIDE.BUY);
        sellOrders = await dex.getOrders(REP, SIDE.SELL);
        assert(buyOrders.length === 3);
        assert(buyOrders[0].trader === trader2);
        assert(buyOrders[1].trader === trader1);
        assert(buyOrders[2].trader === trader2);
        assert(buyOrders[2].price === '9');
        assert(sellOrders.length === 0);
    });

    //uphappy path
    it('Should NOT create limit order if token does not exist', async () => {
        await expectRevert(
            dex.createLimitOrder(
                web3.utils.fromAscii('TOKEN-DOES-NOT-EXIST'), 
                web3.utils.toWei('10'),
                9,
                SIDE.BUY,
                {from: trader2}),
            'this token does not exist'
        ); 
    });

    //uphappy path
    it('Should NOT create limit order if token is DAI', async () => {
        await expectRevert(
            dex.createLimitOrder(
                DAI, 
                web3.utils.toWei('10'),
                9,
                SIDE.BUY,
                {from: trader2}),
            'cannot trade DAI'
        ); 
    });

    //uphappy path
    it('Should NOT create limit order if token balance is too low', async () => {
        await dex.deposit(
            web3.utils.toWei('99'),
            REP,
            {from: trader1}
        );

        await expectRevert(
            dex.createLimitOrder(
                REP,
                web3.utils.toWei('100'),
                10,
                SIDE.SELL,
                {from: trader1}),
            'token balance too low'
        ); 
    });

    //uphappy path
    it('Should NOT create limit order if DAI balance is too low', async () => {
        await dex.deposit(
            web3.utils.toWei('99'),
            DAI,
            {from: trader1}
        );

        await expectRevert(
            dex.createLimitOrder(
                REP,
                web3.utils.toWei('10'),
                10,
                SIDE.BUY,
                {from: trader1}),
            'dai balance too low'
        ); 
    });

    //create market order
    //happy path
    it('Should create market order & match against existing limit order', async () => {
        await dex.deposit(
            web3.utils.toWei('100'), 
            DAI, 
            {from: trader1});
        await dex.createLimitOrder(
            REP,
            web3.utils.toWei('10'),
            10,
            SIDE.BUY,
            {from: trader1});
        
        await dex.deposit(
            web3.utils.toWei('100'), 
            REP, 
            {from: trader2});
        await dex.createMarketOrder(
            REP,
            web3.utils.toWei('5'),
            SIDE.SELL,
            {from: trader2});
        
        const balances = await Promise.all([
            dex.traderBalances(trader1, DAI),
            dex.traderBalances(trader1, REP),
            dex.traderBalances(trader2, DAI),
            dex.traderBalances(trader2, REP)
        ]);
        const orders = await dex.getOrders(REP, SIDE.BUY);
        assert(orders.length === 1);
        assert(orders[0].filled === web3.utils.toWei('5'));
        assert(balances[0].toString() === web3.utils.toWei('50'));
        assert(balances[1].toString() === web3.utils.toWei('5'));
        assert(balances[2].toString() === web3.utils.toWei('50'));
        assert(balances[3].toString() === web3.utils.toWei('95'));
    });

    //uphappy path
    it('Should NOT create market order if token does not exist', async () => {
        await expectRevert(
            dex.createMarketOrder(
                web3.utils.fromAscii('TOKEN-DOES-NOT-EXIST'), 
                web3.utils.toWei('10'),
                SIDE.BUY,
                {from: trader1}),
            'this token does not exist'
        ); 
    });

    //uphappy path
    it('Should NOT create market order if token is DAI', async () => {
        await expectRevert(
            dex.createMarketOrder(
                DAI, 
                web3.utils.toWei('10'),
                SIDE.BUY,
                {from: trader1}),
            'cannot trade DAI'
        ); 
    });

    //uphappy path
    it('Should NOT create market order if token balance is too low', async () => {
        await dex.deposit(
            web3.utils.toWei('99'),
            REP,
            {from: trader1}
        );

        await expectRevert(
            dex.createMarketOrder(
                REP,
                web3.utils.toWei('100'),
                SIDE.SELL,
                {from: trader1}),
            'token balance too low'
        ); 
    });

    //uphappy path
    it('Should NOT create market order if DAI balance is too low', async () => {
        await dex.deposit(
            web3.utils.toWei('10'), 
            REP, 
            {from: trader1});
        await dex.createLimitOrder(
            REP,
            web3.utils.toWei('10'),
            10,
            SIDE.SELL,
            {from: trader1});
        
        await dex.deposit(
            web3.utils.toWei('99'), 
            DAI, 
            {from: trader2});
        
        await expectRevert(
            dex.createMarketOrder(
                REP,
                web3.utils.toWei('10'),
                SIDE.BUY,
                {from: trader2}),
            'dai balance too low'
        ); 
    });
});