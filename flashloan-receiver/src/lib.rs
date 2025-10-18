use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

/// Entry point for the flash loan receiver program
pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    msg!("Flash Loan Receiver: Processing instruction");
    
    // Instruction format from SPL Token Lending:
    // Tag 0: ReceiveFlashLoan
    // Data: [tag: u8, amount: u64]
    
    let (tag, rest) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    
    if *tag != 0 {
        msg!("Invalid instruction tag. Expected 0, got {}", tag);
        return Err(ProgramError::InvalidInstructionData);
    }
    
    let amount = u64::from_le_bytes(
        rest.get(..8)
            .and_then(|slice| slice.try_into().ok())
            .ok_or(ProgramError::InvalidInstructionData)?
    );
    
    msg!("Received flash loan of {} lamports", amount);
    
    let account_info_iter = &mut accounts.iter();
    let source_liquidity_info = next_account_info(account_info_iter)?;
    let destination_liquidity_info = next_account_info(account_info_iter)?;
    let spl_token_program_info = next_account_info(account_info_iter)?;
    let user_transfer_authority_info = next_account_info(account_info_iter)?;
    
    // TODO: Execute arbitrage trades here using the borrowed funds
    // For now, just return the funds immediately
    
    msg!("Returning flash loan amount: {}", amount);
    
    // Return the borrowed amount back to the lending program
    invoke(
        &spl_token::instruction::transfer(
            spl_token_program_info.key,
            destination_liquidity_info.key,
            source_liquidity_info.key,
            user_transfer_authority_info.key,
            &[],
            amount,
        )?,
        &[
            destination_liquidity_info.clone(),
            source_liquidity_info.clone(),
            user_transfer_authority_info.clone(),
            spl_token_program_info.clone(),
        ],
    )?;
    
    msg!("Flash loan receiver completed successfully");
    Ok(())
}
